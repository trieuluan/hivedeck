use std::{collections::HashMap, path::Path, process::Stdio, sync::Arc};

use async_trait::async_trait;
use futures::StreamExt;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use ts_rs::TS;
use workspace_utils::{
    command_ext::GroupSpawnNoWindowExt, msg_store::MsgStore, path::make_path_relative,
};

use crate::{
    command::{CmdOverrides, CommandBuildError, CommandBuilder, apply_overrides},
    env::ExecutionEnv,
    executor_discovery::ExecutorDiscoveredOptions,
    executors::{
        AppendPrompt, AvailabilityInfo, BaseCodingAgent, ExecutorError, SpawnedChild,
        StandardCodingAgentExecutor,
    },
    logs::{
        ActionType, CommandExitStatus, CommandRunResult, NormalizedEntry, NormalizedEntryError,
        NormalizedEntryType, TokenUsageInfo, ToolResult, ToolStatus,
        stderr_processor::normalize_stderr_logs,
        utils::{
            EntryIndexProvider,
            patch::{self, add_normalized_entry, replace_normalized_entry},
            shell_command_parsing::CommandCategory,
        },
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
        let h1 = normalize_agy_logs(
            msg_store.clone(),
            current_dir.to_path_buf(),
            entry_index_provider.clone(),
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

#[derive(Debug, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
enum AgyEvent {
    Init {
        #[serde(default)]
        conversation_id: Option<String>,
        #[serde(default)]
        init: Option<AgyInit>,
    },
    StepUpdate {
        step_update: AgyStepUpdate,
    },
    Result {
        result: AgyResult,
    },
}

#[derive(Debug, Deserialize)]
struct AgyInit {
    #[serde(default)]
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AgyUsage {
    #[serde(default)]
    input_tokens: u32,
    #[serde(default)]
    output_tokens: u32,
    #[serde(default)]
    cache_read_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct AgyStepUpdate {
    #[serde(default)]
    conversation_id: Option<String>,
    step_index: u64,
    #[serde(default)]
    state: String,
    #[serde(default)]
    step_type: String,
    #[serde(default)]
    text_delta: Option<String>,
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    tool_info: Option<AgyToolInfo>,
    #[serde(default)]
    usage: Option<AgyUsage>,
}

#[derive(Debug, Deserialize)]
struct AgyToolInfo {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    parameters: Option<serde_json::Value>,
    #[serde(default)]
    output: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct AgyResult {
    #[serde(default)]
    conversation_id: Option<String>,
    #[serde(default)]
    status: String,
    #[serde(default)]
    response: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    usage: Option<AgyUsage>,
}

#[derive(Default)]
struct AgyLogState {
    session_pushed: bool,
    streamed_any_response: bool,
    model_context_window: u32,
    last_context_tokens: u32,
    session_input_tokens: u32,
    session_output_tokens: u32,
    session_cache_read_tokens: u32,
    active_text_steps: HashMap<u64, (usize, String)>,
    active_tool_steps: HashMap<u64, usize>,
}

fn agy_context_window(model: Option<&str>) -> u32 {
    match model {
        Some(m) if m.to_ascii_lowercase().contains("claude") => 200_000,
        _ => 1_000_000,
    }
}

impl AgyLogState {
    fn maybe_push_session_id(&mut self, msg_store: &Arc<MsgStore>, id: Option<&str>) {
        if !self.session_pushed
            && let Some(id) = id
            && !id.is_empty()
        {
            msg_store.push_session_id(id.to_string());
            self.session_pushed = true;
        }
    }

    fn emit_token_usage(&self, msg_store: &Arc<MsgStore>, index_provider: &EntryIndexProvider) {
        let context_window = if self.model_context_window > 0 {
            self.model_context_window
        } else {
            1_000_000
        };
        add_normalized_entry(
            msg_store,
            index_provider,
            NormalizedEntry {
                timestamp: None,
                entry_type: NormalizedEntryType::TokenUsageInfo(TokenUsageInfo {
                    total_tokens: self.last_context_tokens,
                    model_context_window: context_window,
                    input_tokens: Some(self.session_input_tokens),
                    output_tokens: Some(self.session_output_tokens),
                    cache_read_tokens: Some(self.session_cache_read_tokens),
                    cache_creation_tokens: None,
                }),
                content: format!(
                    "Tokens used: {} / Context window: {}",
                    self.last_context_tokens, context_window
                ),
                metadata: None,
            },
        );
    }

    fn process_line(
        &mut self,
        line: &str,
        msg_store: &Arc<MsgStore>,
        index_provider: &EntryIndexProvider,
        worktree_path: &str,
    ) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return;
        }
        let Ok(event) = serde_json::from_str::<AgyEvent>(trimmed) else {
            return;
        };

        match event {
            AgyEvent::Init {
                conversation_id,
                init,
            } => {
                self.maybe_push_session_id(msg_store, conversation_id.as_deref());
                let model = init.and_then(|i| i.model);
                self.model_context_window = agy_context_window(model.as_deref());
                if let Some(model) = model
                    && !model.is_empty()
                {
                    add_normalized_entry(
                        msg_store,
                        index_provider,
                        NormalizedEntry {
                            timestamp: None,
                            entry_type: NormalizedEntryType::SystemMessage,
                            content: format!("Model: {model}"),
                            metadata: None,
                        },
                    );
                }
            }
            AgyEvent::StepUpdate { step_update } => {
                self.maybe_push_session_id(msg_store, step_update.conversation_id.as_deref());
                match step_update.step_type.as_str() {
                    "agent_response" => {
                        let usage = step_update.usage;
                        self.handle_agent_response(
                            step_update.step_index,
                            &step_update.state,
                            step_update.text_delta.as_deref(),
                            msg_store,
                            index_provider,
                        );
                        if let Some(u) = usage {
                            self.last_context_tokens = u
                                .input_tokens
                                .saturating_add(u.cache_read_tokens)
                                .saturating_add(u.output_tokens);
                            self.session_input_tokens =
                                self.session_input_tokens.saturating_add(u.input_tokens);
                            self.session_output_tokens =
                                self.session_output_tokens.saturating_add(u.output_tokens);
                            self.session_cache_read_tokens = self
                                .session_cache_read_tokens
                                .saturating_add(u.cache_read_tokens);
                            self.emit_token_usage(msg_store, index_provider);
                        }
                    }
                    "tool" => self.handle_tool_step(
                        step_update,
                        msg_store,
                        index_provider,
                        worktree_path,
                    ),
                    _ => {}
                }
            }
            AgyEvent::Result { result } => {
                self.maybe_push_session_id(msg_store, result.conversation_id.as_deref());
                if let Some(u) = result.usage {
                    self.session_input_tokens = u.input_tokens;
                    self.session_output_tokens = u.output_tokens;
                    self.session_cache_read_tokens = u.cache_read_tokens;
                    if self.last_context_tokens == 0 {
                        self.last_context_tokens = u
                            .input_tokens
                            .saturating_add(u.cache_read_tokens)
                            .saturating_add(u.output_tokens);
                    }
                    self.emit_token_usage(msg_store, index_provider);
                }
                if result.status == "SUCCESS" {
                    if !self.streamed_any_response
                        && let Some(resp) = result.response
                        && !resp.trim().is_empty()
                    {
                        add_normalized_entry(
                            msg_store,
                            index_provider,
                            NormalizedEntry {
                                timestamp: None,
                                entry_type: NormalizedEntryType::AssistantMessage,
                                content: resp,
                                metadata: None,
                            },
                        );
                    }
                } else {
                    let msg = result
                        .error
                        .or(result.response)
                        .filter(|s| !s.trim().is_empty())
                        .unwrap_or_else(|| format!("Antigravity finished with status {}", result.status));
                    add_normalized_entry(
                        msg_store,
                        index_provider,
                        NormalizedEntry {
                            timestamp: None,
                            entry_type: NormalizedEntryType::ErrorMessage {
                                error_type: NormalizedEntryError::Other,
                            },
                            content: msg,
                            metadata: None,
                        },
                    );
                }
            }
        }
    }

    fn handle_agent_response(
        &mut self,
        step_index: u64,
        state: &str,
        text_delta: Option<&str>,
        msg_store: &Arc<MsgStore>,
        index_provider: &EntryIndexProvider,
    ) {
        if let Some(delta) = text_delta
            && !delta.is_empty()
        {
            self.streamed_any_response = true;
            if let Some((entry_idx, acc)) = self.active_text_steps.get_mut(&step_index) {
                acc.push_str(delta);
                replace_normalized_entry(
                    msg_store,
                    *entry_idx,
                    NormalizedEntry {
                        timestamp: None,
                        entry_type: NormalizedEntryType::AssistantMessage,
                        content: acc.clone(),
                        metadata: None,
                    },
                );
            } else {
                let acc = delta.to_string();
                let entry_idx = add_normalized_entry(
                    msg_store,
                    index_provider,
                    NormalizedEntry {
                        timestamp: None,
                        entry_type: NormalizedEntryType::AssistantMessage,
                        content: acc.clone(),
                        metadata: None,
                    },
                );
                self.active_text_steps.insert(step_index, (entry_idx, acc));
            }
        }
        if state == "DONE" {
            self.active_text_steps.remove(&step_index);
        }
    }

    fn handle_tool_step(
        &mut self,
        step: AgyStepUpdate,
        msg_store: &Arc<MsgStore>,
        index_provider: &EntryIndexProvider,
        worktree_path: &str,
    ) {
        let info = step.tool_info;
        let raw_name = step
            .tool_name
            .or_else(|| info.as_ref().and_then(|i| i.name.clone()))
            .unwrap_or_else(|| "tool".to_string());
        let params = info.as_ref().and_then(|i| i.parameters.clone());
        let output_str = info.as_ref().and_then(|i| i.output.as_ref()).map(value_to_string);

        let status = match step.state.as_str() {
            "DONE" => ToolStatus::Success,
            "ERROR" | "FAILED" => ToolStatus::Failed,
            _ => ToolStatus::Created,
        };

        let (action_type, content) = build_agy_tool_action(&raw_name, params, output_str, worktree_path);
        let entry = NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: raw_name,
                action_type,
                status,
            },
            content,
            metadata: None,
        };

        if let Some(&entry_idx) = self.active_tool_steps.get(&step.step_index) {
            replace_normalized_entry(msg_store, entry_idx, entry);
        } else {
            let entry_idx = add_normalized_entry(msg_store, index_provider, entry);
            self.active_tool_steps.insert(step.step_index, entry_idx);
        }
        if matches!(step.state.as_str(), "DONE" | "ERROR" | "FAILED") {
            self.active_tool_steps.remove(&step.step_index);
        }
    }
}

fn value_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_else(|_| other.to_string()),
    }
}

fn extract_str_param(params: Option<&serde_json::Value>, keys: &[&str]) -> Option<String> {
    let map = params?.as_object()?;
    for key in keys {
        if let Some(val) = map.get(*key).and_then(|v| v.as_str())
            && !val.is_empty()
        {
            return Some(val.to_string());
        }
    }
    None
}

fn build_agy_tool_action(
    tool_name: &str,
    params: Option<serde_json::Value>,
    output: Option<String>,
    worktree_path: &str,
) -> (ActionType, String) {
    let p_ref = params.as_ref();
    match tool_name {
        "read_file" | "view_file" => {
            let raw_path =
                extract_str_param(p_ref, &["Path", "path", "AbsolutePath"]).unwrap_or_default();
            let path = make_path_relative(&raw_path, worktree_path);
            let content = format!("`{path}`");
            (ActionType::FileRead { path }, content)
        }
        "write_file"
        | "edit_file"
        | "write_to_file"
        | "replace_file_content"
        | "multi_replace_file_content" => {
            let raw_path =
                extract_str_param(p_ref, &["Path", "path", "TargetFile"]).unwrap_or_default();
            let path = make_path_relative(&raw_path, worktree_path);
            let content = format!("`{path}`");
            (
                ActionType::FileEdit {
                    path,
                    changes: Vec::new(),
                },
                content,
            )
        }
        "run_command" => {
            let command =
                extract_str_param(p_ref, &["CommandLine", "command"]).unwrap_or_default();
            let content = format!("`{command}`");
            let result = output.map(|out| CommandRunResult {
                exit_status: Some(CommandExitStatus::Success { success: true }),
                output: Some(out),
            });
            (
                ActionType::CommandRun {
                    command,
                    result,
                    category: CommandCategory::default(),
                },
                content,
            )
        }
        "grep_search" | "find_by_name" | "search_web" => {
            let query =
                extract_str_param(p_ref, &["Query", "query", "Pattern", "pattern"])
                    .unwrap_or_default();
            let content = format!("`{query}`");
            (ActionType::Search { query }, content)
        }
        _ => (
            ActionType::Tool {
                tool_name: tool_name.to_string(),
                arguments: params,
                result: output.map(ToolResult::markdown),
            },
            tool_name.to_string(),
        ),
    }
}

fn normalize_agy_logs(
    msg_store: Arc<MsgStore>,
    current_dir: std::path::PathBuf,
    entry_index_provider: EntryIndexProvider,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut lines = msg_store.stdout_lines_stream();
        let worktree_path = current_dir.to_string_lossy().into_owned();
        let mut state = AgyLogState::default();

        while let Some(Ok(line)) = lines.next().await {
            state.process_line(&line, &msg_store, &entry_index_provider, &worktree_path);
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_agy_init_text_tool_and_result_events() {
        let msg_store = Arc::new(MsgStore::new());
        let index_provider = EntryIndexProvider::start_from(&msg_store);
        let mut state = AgyLogState::default();
        let worktree = "/repo";

        state.process_line(
            r#"{"event":"init","conversation_id":"conv-123","init":{"model":"gemini-4-hydrogen-medium"}}"#,
            &msg_store,
            &index_provider,
            worktree,
        );
        state.process_line(
            r#"{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"read_file","tool_info":{"name":"read_file","parameters":{"Path":"/repo/src/main.rs"}}}}"#,
            &msg_store,
            &index_provider,
            worktree,
        );
        state.process_line(
            r#"{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":2,"state":"DONE","step_type":"tool","tool_name":"read_file","tool_info":{"name":"read_file","parameters":{"Path":"/repo/src/main.rs"},"output":"fn main() {}"}}}"#,
            &msg_store,
            &index_provider,
            worktree,
        );
        state.process_line(
            r#"{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":3,"state":"ACTIVE","step_type":"agent_response","text_delta":"Hello "}}"#,
            &msg_store,
            &index_provider,
            worktree,
        );
        state.process_line(
            r#"{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":3,"state":"ACTIVE","step_type":"agent_response","text_delta":"world"}}"#,
            &msg_store,
            &index_provider,
            worktree,
        );
        state.process_line(
            r#"{"event":"step_update","step_update":{"conversation_id":"conv-123","step_index":3,"state":"DONE","step_type":"agent_response","usage":{"input_tokens":1200,"output_tokens":300,"cache_read_tokens":5000}}}"#,
            &msg_store,
            &index_provider,
            worktree,
        );
        state.process_line(
            r#"{"event":"result","result":{"conversation_id":"conv-123","status":"SUCCESS","response":"Hello world","usage":{"input_tokens":1200,"output_tokens":300,"cache_read_tokens":5000}}}"#,
            &msg_store,
            &index_provider,
            worktree,
        );

        let history = msg_store.get_history();
        assert!(history.iter().any(|m| {
            matches!(m, workspace_utils::log_msg::LogMsg::SessionId(id) if id == "conv-123")
        }));
        let patches: Vec<_> = history
            .iter()
            .filter_map(|m| match m {
                workspace_utils::log_msg::LogMsg::JsonPatch(p) => Some(p),
                _ => None,
            })
            .collect();
        // init (1) + tool active (1) + tool done (1) + text add (1) + text replace (1) + step usage (1) + result usage (1) = 7
        assert_eq!(patches.len(), 7);
    }
}
