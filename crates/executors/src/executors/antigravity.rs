use std::{path::Path, process::Stdio, sync::Arc};

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::{io::AsyncWriteExt, process::Command};
use ts_rs::TS;
use workspace_utils::{command_ext::GroupSpawnNoWindowExt, msg_store::MsgStore};

use crate::{
    command::{CmdOverrides, CommandBuildError, CommandBuilder, apply_overrides},
    env::ExecutionEnv,
    executors::{
        AppendPrompt, AvailabilityInfo, BaseCodingAgent, ExecutorError, SpawnedChild,
        StandardCodingAgentExecutor,
        claude::{ClaudeLogProcessor, HistoryStrategy},
    },
    logs::{stderr_processor::normalize_stderr_logs, utils::EntryIndexProvider},
    model_selector::PermissionPolicy,
    profile::ExecutorConfig,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema)]
pub struct Antigravity {
    #[serde(default)]
    pub append_prompt: AppendPrompt,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(
        title = "Dangerously Skip Permissions",
        description = "Auto-approve all tool permission requests without prompting (--dangerously-skip-permissions)."
    )]
    pub dangerously_skip_permissions: Option<bool>,
    #[serde(flatten)]
    pub cmd: CmdOverrides,
}

impl Antigravity {
    pub(crate) fn build_command_builder(
        &self,
        env: &ExecutionEnv,
    ) -> Result<CommandBuilder, CommandBuildError> {
        let mut builder =
            CommandBuilder::new("agy").params(["-p", "--output-format=stream-json"]);
        if self.dangerously_skip_permissions.unwrap_or(false) {
            builder = builder.extend_params(["--dangerously-skip-permissions"]);
        }
        if let Some(model) = &self.model {
            builder = builder.extend_params(["--model", model.as_str()]);
        }
        if let Some(effort) = &self.effort {
            builder = builder.extend_params(["--effort", effort.as_str()]);
        }
        for dir in &env.skill_dirs {
            builder = builder.extend_params(["--add-dir", &dir.to_string_lossy()]);
        }
        apply_overrides(builder, &self.cmd)
    }

    async fn spawn_with_args(
        &self,
        current_dir: &Path,
        program: std::path::PathBuf,
        args: Vec<String>,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let combined_prompt = format!(
            "{}{}",
            crate::plugins::skills_catalog(&env.skill_dirs).unwrap_or_default(),
            self.append_prompt.combine_prompt(prompt)
        );

        let mut command = Command::new(program);
        command
            .kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(current_dir)
            .args(&args);

        env.clone()
            .with_profile(&self.cmd)
            .apply_to_command(&mut command);

        let mut child = command.group_spawn_no_window()?;

        if let Some(mut stdin) = child.inner().stdin.take() {
            stdin.write_all(combined_prompt.as_bytes()).await?;
            stdin.shutdown().await?;
        }

        Ok(child.into())
    }
}

#[async_trait]
impl StandardCodingAgentExecutor for Antigravity {
    fn apply_overrides(&mut self, executor_config: &ExecutorConfig) {
        if let Some(model_id) = &executor_config.model_id {
            self.model = Some(model_id.clone());
        }
        if let Some(reasoning_id) = &executor_config.reasoning_id {
            self.effort = Some(reasoning_id.clone());
        }
        if let Some(permission_policy) = executor_config.permission_policy.clone() {
            self.dangerously_skip_permissions = Some(matches!(
                permission_policy,
                PermissionPolicy::Auto | PermissionPolicy::Supervised
            ));
        }
    }

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let command_parts = self.build_command_builder(env)?.build_initial()?;
        let (program, args) = command_parts.into_resolved().await?;
        self.spawn_with_args(current_dir, program, args, prompt, env)
            .await
    }

    async fn spawn_follow_up(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: &str,
        _reset_to_message_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let command_parts = self
            .build_command_builder(env)?
            .build_follow_up(&["--conversation".to_string(), session_id.to_string()])?;
        let (program, args) = command_parts.into_resolved().await?;
        self.spawn_with_args(current_dir, program, args, prompt, env)
            .await
    }

    fn normalize_logs(
        &self,
        msg_store: Arc<MsgStore>,
        current_dir: &Path,
    ) -> Vec<tokio::task::JoinHandle<()>> {
        let entry_index_provider = EntryIndexProvider::start_from(&msg_store);

        let h1 = ClaudeLogProcessor::process_logs(
            msg_store.clone(),
            current_dir,
            entry_index_provider.clone(),
            HistoryStrategy::Default,
        );
        let h2 = normalize_stderr_logs(msg_store, entry_index_provider);

        vec![h1, h2]
    }

    fn default_mcp_config_path(&self) -> Option<std::path::PathBuf> {
        None
    }

    fn get_preset_options(&self) -> ExecutorConfig {
        ExecutorConfig {
            executor: BaseCodingAgent::Antigravity,
            variant: None,
            model_id: self.model.clone(),
            agent_id: None,
            reasoning_id: self.effort.clone(),
            permission_policy: Some(if self.dangerously_skip_permissions.unwrap_or(false) {
                PermissionPolicy::Auto
            } else {
                PermissionPolicy::Supervised
            }),
        }
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        let settings_path = dirs::home_dir().map(|home| {
            home.join(".gemini")
                .join("antigravity-cli")
                .join("settings.json")
        });
        if let Some(path) = settings_path
            && let Some(timestamp) = std::fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
        {
            return AvailabilityInfo::LoginDetected {
                last_auth_timestamp: timestamp,
            };
        }
        AvailabilityInfo::NotFound
    }
}
