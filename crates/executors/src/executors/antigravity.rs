use std::{path::Path, process::Stdio, sync::Arc};

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use ts_rs::TS;
use workspace_utils::{command_ext::GroupSpawnNoWindowExt, msg_store::MsgStore};

use crate::{
    command::{CmdOverrides, CommandBuildError, CommandBuilder, apply_overrides},
    env::ExecutionEnv,
    executor_discovery::ExecutorDiscoveredOptions,
    executors::{
        AppendPrompt, AvailabilityInfo, BaseCodingAgent, ExecutorError, SpawnedChild,
        StandardCodingAgentExecutor,
        claude::{ClaudeLogProcessor, HistoryStrategy},
    },
    logs::{
        stderr_processor::normalize_stderr_logs,
        utils::{EntryIndexProvider, patch},
    },
    model_selector::{ModelInfo, ModelSelectorConfig, PermissionPolicy},
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
        let mut builder = CommandBuilder::new(resolve_agy_binary().to_string_lossy().into_owned())
            .params(["--output-format=stream-json"]);
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
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(current_dir)
            .args(&args)
            .arg(format!("--print={combined_prompt}"));

        env.clone()
            .with_profile(&self.cmd)
            .apply_to_command(&mut command);

        let child = command.group_spawn_no_window()?;

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

    async fn discover_options(
        &self,
        _workdir: Option<&Path>,
        _repo_path: Option<&Path>,
    ) -> Result<futures::stream::BoxStream<'static, json_patch::Patch>, ExecutorError> {
        let models = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            discover_agy_models(),
        )
        .await
        .unwrap_or_default();

        let options = ExecutorDiscoveredOptions {
            model_selector: ModelSelectorConfig {
                models,
                default_model: None,
                permissions: vec![PermissionPolicy::Auto, PermissionPolicy::Supervised],
                ..Default::default()
            },
            ..Default::default()
        };

        Ok(Box::pin(futures::stream::once(async move {
            patch::executor_discovered_options(options)
        })))
    }
}

fn resolve_agy_binary() -> std::path::PathBuf {
    if let Some(home) = dirs::home_dir() {
        let local_bin = home.join(".local").join("bin").join(if cfg!(windows) {
            "agy.exe"
        } else {
            "agy"
        });
        if local_bin.is_file() {
            return local_bin;
        }
    }
    std::path::PathBuf::from("agy")
}

async fn discover_agy_models() -> Vec<ModelInfo> {
    let bin = resolve_agy_binary();
    let Ok(output) = Command::new(bin).arg("models").output().await else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut models = Vec::new();
    for raw_line in stdout.lines() {
        // Spinner lines use '\r'; take the final segment after '\r'
        let line = raw_line.rsplit('\r').next().unwrap_or("").trim();
        if line.is_empty() || line.contains("Fetching available models") {
            continue;
        }
        let mut parts = line.splitn(2, char::is_whitespace);
        let Some(id) = parts.next().map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };
        let name = parts
            .next()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(id);
        models.push(ModelInfo {
            id: id.to_string(),
            name: name.to_string(),
            provider_id: None,
            reasoning_options: vec![],
        });
    }
    models
}
