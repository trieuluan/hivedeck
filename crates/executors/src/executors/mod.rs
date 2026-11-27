use std::{path::Path, sync::Arc};

use async_trait::async_trait;
use command_group::AsyncGroupChild;
use enum_dispatch::enum_dispatch;
use futures::stream::BoxStream;
use futures_io::Error as FuturesIoError;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sqlx::Type;
use strum_macros::{Display, EnumDiscriminants, EnumIter, EnumString, VariantNames};
use thiserror::Error;
use tokio::task::JoinHandle;
use ts_rs::TS;
use workspace_utils::msg_store::MsgStore;

#[cfg(feature = "qa-mode")]
use crate::executors::qa_mock::QaMockExecutor;
use crate::{
    actions::{ExecutorAction, review::RepoReviewContext},
    approvals::ExecutorApprovalService,
    command::CommandBuildError,
    env::ExecutionEnv,
    executors::{
        amp::Amp, antigravity::Antigravity, claude::ClaudeCode, claude::ClaudeCodeHeaded,
        codex::Codex, copilot::Copilot, cursor::CursorAgent, droid::Droid, gemini::Gemini,
        opencode::Opencode, opencode::OpencodeHeaded, qwen::QwenCode,
    },
    logs::utils::patch,
    mcp_config::McpConfig,
    profile::ExecutorConfig,
};

pub mod acp;
pub mod amp;
pub mod antigravity;
pub mod claude;
pub mod codex;
pub mod copilot;
pub mod cursor;
pub mod droid;
pub mod gemini;
pub mod opencode;
#[cfg(feature = "qa-mode")]
pub mod qa_mock;
pub mod qwen;
pub mod utils;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct SlashCommandDescription {
    /// Command name without the leading slash, e.g. `help` for `/help`.
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(use_ts_enum)]
pub enum BaseAgentCapability {
    SessionFork,
    /// Agent requires a setup script before it can run (e.g., login, installation)
    SetupHelper,
    /// Agent reports context/token usage information
    ContextUsage,
}

#[derive(Debug, Error)]
pub enum ExecutorError {
    #[error("Follow-up is not supported: {0}")]
    FollowUpNotSupported(String),
    #[error(transparent)]
    SpawnError(#[from] FuturesIoError),
    #[error("Unknown executor type: {0}")]
    UnknownExecutorType(String),
    #[error("I/O error: {0}")]
    Io(std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    TomlSerialize(#[from] toml::ser::Error),
    #[error(transparent)]
    TomlDeserialize(#[from] toml::de::Error),
    #[error(transparent)]
    ExecutorApprovalError(#[from] crate::approvals::ExecutorApprovalError),
    #[error(transparent)]
    CommandBuild(#[from] CommandBuildError),
    #[error("Executable `{program}` not found in PATH")]
    ExecutableNotFound { program: String },
    #[error("Setup helper not supported")]
    SetupHelperNotSupported,
    #[error("Auth required: {0}")]
    AuthRequired(String),
}

#[enum_dispatch]
#[derive(
    Debug, Clone, Serialize, Deserialize, PartialEq, TS, Display, EnumDiscriminants, VariantNames,
)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE")]
#[strum_discriminants(
    name(BaseCodingAgent),
    // Only add Hash; Eq/PartialEq are already provided by EnumDiscriminants.
    derive(EnumString, EnumIter, Hash, strum_macros::Display, Serialize, Deserialize, TS, Type),
    strum(serialize_all = "SCREAMING_SNAKE_CASE"),
    ts(use_ts_enum),
    serde(rename_all = "SCREAMING_SNAKE_CASE"),
    sqlx(type_name = "TEXT", rename_all = "SCREAMING_SNAKE_CASE")
)]
pub enum CodingAgent {
    ClaudeCode,
    ClaudeCodeHeaded,
    Amp,
    Gemini,
    Codex,
    Opencode,
    OpencodeHeaded,
    #[serde(alias = "CURSOR")]
    #[strum_discriminants(serde(alias = "CURSOR"))]
    #[strum_discriminants(strum(serialize = "CURSOR", serialize = "CURSOR_AGENT"))]
    CursorAgent,
    QwenCode,
    Copilot,
    Droid,
    Antigravity,
    #[cfg(feature = "qa-mode")]
    QaMock(QaMockExecutor),
}

impl CodingAgent {
    pub fn get_mcp_config(&self) -> McpConfig {
        match self {
            Self::Codex(_) => McpConfig::new(
                vec!["mcp_servers".to_string()],
                serde_json::json!({
                    "mcp_servers": {}
                }),
                self.preconfigured_mcp(),
                true,
            ),
            Self::Amp(_) => McpConfig::new(
                vec!["amp.mcpServers".to_string()],
                serde_json::json!({
                    "amp.mcpServers": {}
                }),
                self.preconfigured_mcp(),
                false,
            ),
            Self::Opencode(_) | Self::OpencodeHeaded(_) => McpConfig::new(
                vec!["mcp".to_string()],
                serde_json::json!({
                    "mcp": {},
                    "$schema": "https://opencode.ai/config.json"
                }),
                self.preconfigured_mcp(),
                false,
            ),
            Self::Droid(_) => McpConfig::new(
                vec!["mcpServers".to_string()],
                serde_json::json!({
                    "mcpServers": {}
                }),
                self.preconfigured_mcp(),
                false,
            ),
            _ => McpConfig::new(
                vec!["mcpServers".to_string()],
                serde_json::json!({
                    "mcpServers": {}
                }),
                self.preconfigured_mcp(),
                false,
            ),
        }
    }

    pub fn supports_mcp(&self) -> bool {
        self.default_mcp_config_path().is_some()
    }

    pub fn capabilities(&self) -> Vec<BaseAgentCapability> {
        match self {
            Self::ClaudeCode(_) | Self::ClaudeCodeHeaded(_) => vec![
                BaseAgentCapability::SessionFork,
                BaseAgentCapability::ContextUsage,
            ],
            Self::Opencode(_) | Self::OpencodeHeaded(_) => vec![
                BaseAgentCapability::SessionFork,
                BaseAgentCapability::ContextUsage,
            ],
            Self::Codex(_) => vec![
                BaseAgentCapability::SessionFork,
                BaseAgentCapability::SetupHelper,
                BaseAgentCapability::ContextUsage,
            ],
            Self::Gemini(_) | Self::QwenCode(_) | Self::Antigravity(_) => {
                vec![BaseAgentCapability::SessionFork]
            }
            Self::CursorAgent(_) => vec![BaseAgentCapability::SetupHelper],
            Self::Amp(_) | Self::Copilot(_) | Self::Droid(_) => vec![],
            #[cfg(feature = "qa-mode")]
            Self::QaMock(_) => vec![], // QA mock doesn't need special capabilities
        }
    }
}

impl BaseCodingAgent {
    /// Whether this agent runs as an interactive TUI inside a detached tmux
    /// session ("headed"), as opposed to a headless child process driven over
    /// stdio/HTTP. The container uses this to decide between the detached-tmux
    /// launch path and a normal owned-child spawn.
    pub fn is_headed(&self) -> bool {
        matches!(self, Self::ClaudeCodeHeaded | Self::OpencodeHeaded)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AvailabilityInfo {
    LoginDetected { last_auth_timestamp: i64 },
    InstallationFound,
    NotFound,
}

impl AvailabilityInfo {
    pub fn is_available(&self) -> bool {
        matches!(
            self,
            AvailabilityInfo::LoginDetected { .. } | AvailabilityInfo::InstallationFound
        )
    }
}

#[async_trait]
#[enum_dispatch(CodingAgent)]
pub trait StandardCodingAgentExecutor {
    fn apply_overrides(&mut self, _executor_config: &ExecutorConfig) {}

    fn use_approvals(&mut self, _approvals: Arc<dyn ExecutorApprovalService>) {}

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError>;

    /// Continue a session, optionally resetting to a specific message.
    async fn spawn_follow_up(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: &str,
        reset_to_message_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError>;

    async fn spawn_review(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        match session_id {
            Some(id) => {
                self.spawn_follow_up(current_dir, prompt, id, None, env)
                    .await
            }
            None => self.spawn(current_dir, prompt, env).await,
        }
    }

    fn normalize_logs(
        &self,
        _raw_logs_event_store: Arc<MsgStore>,
        _worktree_path: &Path,
    ) -> Vec<JoinHandle<()>> {
        vec![]
    }

    // MCP configuration methods
    fn default_mcp_config_path(&self) -> Option<std::path::PathBuf>;

    async fn get_setup_helper_action(&self) -> Result<ExecutorAction, ExecutorError> {
        Err(ExecutorError::SetupHelperNotSupported)
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        let config_files_found = self
            .default_mcp_config_path()
            .map(|path| path.exists())
            .unwrap_or(false);

        if config_files_found {
            AvailabilityInfo::InstallationFound
        } else {
            AvailabilityInfo::NotFound
        }
    }

    /// Returns a stream of executor discovered options updates.
    async fn discover_options(
        &self,
        _workdir: Option<&Path>,
        _repo_path: Option<&Path>,
    ) -> Result<BoxStream<'static, json_patch::Patch>, ExecutorError> {
        let options = crate::executor_discovery::ExecutorDiscoveredOptions::default();
        Ok(Box::pin(futures::stream::once(async move {
            patch::executor_discovered_options(options)
        })))
    }

    /// Returns the default overrides defined by this preset/variant.
    fn get_preset_options(&self) -> ExecutorConfig;
}

/// Result communicated through the exit signal
#[derive(Debug, Clone, Copy)]
pub enum ExecutorExitResult {
    /// Process completed successfully (exit code 0)
    Success,
    /// Process should be marked as failed (non-zero exit)
    Failure,
}

/// Optional exit notification from an executor.
/// When this receiver resolves, the container should gracefully stop the process
/// and mark it according to the result.
pub type ExecutorExitSignal = tokio::sync::oneshot::Receiver<ExecutorExitResult>;

/// Cancellation token for requesting graceful shutdown of an executor.
/// When cancelled, the executor should attempt to cancel gracefully before being killed.
pub type CancellationToken = tokio_util::sync::CancellationToken;

#[derive(Debug)]
pub struct SpawnedChild {
    pub child: AsyncGroupChild,
    /// Executor → Container: signals when executor wants to exit
    pub exit_signal: Option<ExecutorExitSignal>,
    /// Container → Executor: signals when container wants to cancel the execution
    pub cancel: Option<CancellationToken>,
}

impl From<AsyncGroupChild> for SpawnedChild {
    fn from(child: AsyncGroupChild) -> Self {
        Self {
            child,
            exit_signal: None,
            cancel: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema)]
#[serde(transparent)]
#[schemars(
    title = "Append Prompt",
    description = "Extra text appended to the prompt",
    extend("format" = "textarea")
)]
#[derive(Default)]
pub struct AppendPrompt(pub Option<String>);

impl AppendPrompt {
    pub fn get(&self) -> Option<String> {
        self.0.clone()
    }

    pub fn combine_prompt(&self, prompt: &str) -> String {
        match self {
            AppendPrompt(Some(value)) => format!("{prompt}{value}"),
            AppendPrompt(None) => prompt.to_string(),
        }
    }
}

pub fn build_review_prompt(
    context: Option<&[RepoReviewContext]>,
    additional_prompt: Option<&str>,
) -> String {
    let mut prompt = String::from("Please review the code changes.\n\n");

    if let Some(repos) = context {
        for repo in repos {
            prompt.push_str(&format!("Repository: {}\n", repo.repo_name));
            prompt.push_str(&format!(
                "Review all changes from base commit {} to HEAD.\n",
                repo.base_commit
            ));
            prompt.push_str(&format!(
                "Use `git diff {}..HEAD` to see the changes.\n",
                repo.base_commit
            ));
            prompt.push('\n');
        }
    }

    if let Some(additional) = additional_prompt {
        prompt.push_str(additional);
    }

    prompt
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::*;

    #[test]
    fn new_executor_injection_arguments() {
        let empty_env = ExecutionEnv::new(
            crate::env::RepoContext::new("/tmp".into(), vec![]),
            false,
            String::new(),
        );
        let amp: Amp = serde_json::from_str("{}").unwrap();
        let copilot: Copilot = serde_json::from_str("{}").unwrap();
        let cursor: CursorAgent = serde_json::from_str("{}").unwrap();
        let droid: Droid = serde_json::from_str("{}").unwrap();
        assert!(
            !amp.build_command_builder(&empty_env)
                .unwrap()
                .build_initial()
                .unwrap()
                .args()
                .iter()
                .any(|a| a == "--mcp-config")
        );
        assert!(
            !copilot
                .build_command_builder(&empty_env)
                .unwrap()
                .build_initial()
                .unwrap()
                .args()
                .iter()
                .any(|a| a == "--additional-mcp-config" || a == "--add-dir")
        );
        assert!(
            !copilot
                .with_skills_env(&empty_env)
                .vars
                .contains_key("COPILOT_SKILLS_DIRS")
        );
        assert!(
            !cursor
                .build_command_builder(&empty_env)
                .unwrap()
                .build_initial()
                .unwrap()
                .args()
                .iter()
                .any(|a| a == "--plugin-dir")
        );
        assert!(
            !droid
                .build_command_builder(&empty_env)
                .unwrap()
                .build_initial()
                .unwrap()
                .args()
                .iter()
                .any(|a| a == "--settings")
        );

        let mut env = empty_env;
        env.runtime_config_path = Some("/tmp/run config".into());
        env.skill_dirs = vec!["/tmp/run skills".into()];
        env.mcp_servers
            .push(crate::mcp_registry::InjectedMcpServer {
                name: "probe".into(),
                transport: "stdio".into(),
                command: Some("server".into()),
                args: vec!["--flag".into()],
                url: None,
                headers: Default::default(),
                env: [("API_KEY".into(), "HIVEDECK_MCP_PROBE_KEY_TOKEN".into())].into(),
                instructions: None,
            });
        env.mcp_servers
            .push(crate::mcp_registry::InjectedMcpServer {
                name: "remote".into(),
                transport: "http".into(),
                command: None,
                args: vec![],
                url: Some("https://example.test/mcp".into()),
                headers: [("Authorization".into(), "HIVEDECK_MCP_REMOTE_TOKEN".into())].into(),
                env: Default::default(),
                instructions: None,
            });
        let arg_after = |args: &[String], flag: &str| {
            args.windows(2)
                .find_map(|pair| (pair[0] == flag).then(|| pair[1].clone()))
                .unwrap_or_else(|| panic!("missing {flag} in {args:?}"))
        };
        let stdio_expected = serde_json::json!({"command":"server","args":["--flag"],"env":{"API_KEY":"${HIVEDECK_MCP_PROBE_KEY_TOKEN}"}});
        let http_expected = serde_json::json!({"url":"https://example.test/mcp","headers":{"Authorization":"Bearer ${HIVEDECK_MCP_REMOTE_TOKEN}"}});
        for args in [
            amp.build_command_builder(&env)
                .unwrap()
                .build_initial()
                .unwrap()
                .args()
                .to_vec(),
            amp.build_command_builder(&env)
                .unwrap()
                .build_follow_up(&["continue".into()])
                .unwrap()
                .args()
                .to_vec(),
        ] {
            let parsed: serde_json::Value =
                serde_json::from_str(&arg_after(&args, "--mcp-config")).unwrap();
            assert_eq!(
                parsed,
                serde_json::json!({"probe": stdio_expected, "remote": http_expected})
            );
        }
        env.insert("COPILOT_SKILLS_DIRS", "/tmp/existing,/tmp/run skills");
        for args in [
            copilot
                .build_command_builder(&env)
                .unwrap()
                .build_initial()
                .unwrap(),
            copilot
                .build_command_builder(&env)
                .unwrap()
                .build_follow_up(&["--resume=id".into()])
                .unwrap(),
        ] {
            let parsed: serde_json::Value =
                serde_json::from_str(&arg_after(args.args(), "--additional-mcp-config")).unwrap();
            assert_eq!(
                parsed,
                serde_json::json!({"mcpServers":{
                    "probe":{"type":"stdio","command":"server","args":["--flag"],"env":{"API_KEY":"${HIVEDECK_MCP_PROBE_KEY_TOKEN}"},"tools":["*"]},
                    "remote":{"type":"http","url":"https://example.test/mcp","headers":{"Authorization":"Bearer ${HIVEDECK_MCP_REMOTE_TOKEN}"},"tools":["*"]}
                }})
            );
            assert_eq!(arg_after(args.args(), "--add-dir"), "/tmp/run skills");
        }
        assert_eq!(
            copilot.with_skills_env(&env).vars["COPILOT_SKILLS_DIRS"],
            "/tmp/existing,/tmp/run skills"
        );
        for args in [
            cursor
                .build_command_builder(&env)
                .unwrap()
                .build_initial()
                .unwrap(),
            cursor
                .build_command_builder(&env)
                .unwrap()
                .build_follow_up(&["--resume".into(), "id".into()])
                .unwrap(),
        ] {
            assert_eq!(arg_after(args.args(), "--plugin-dir"), "/tmp/run config");
        }
        for args in [
            droid
                .build_command_builder(&env)
                .unwrap()
                .build_initial()
                .unwrap(),
            droid
                .build_command_builder(&env)
                .unwrap()
                .build_follow_up(&["--session-id".into(), "id".into()])
                .unwrap(),
        ] {
            assert_eq!(arg_after(args.args(), "--settings"), "/tmp/run config");
        }
    }

    #[test]
    fn every_base_coding_agent_routes_injection_or_is_explicitly_unsupported() {
        use strum::IntoEnumIterator;
        let mut env = ExecutionEnv::new(
            crate::env::RepoContext::new("/tmp".into(), vec![]),
            false,
            String::new(),
        );
        env.runtime_config_path = Some("/tmp/run-cfg".into());
        env.skill_dirs = vec!["/tmp/run-skills".into()];
        env.mcp_servers
            .push(crate::mcp_registry::InjectedMcpServer {
                name: "probe".into(),
                transport: "stdio".into(),
                command: Some("server".into()),
                args: vec![],
                url: None,
                headers: Default::default(),
                env: Default::default(),
                instructions: None,
            });
        for agent in BaseCodingAgent::iter() {
            let compat = crate::plugins::executor_compatibility_for(agent);
            let coding: CodingAgent =
                serde_json::from_value(serde_json::json!({ agent.to_string(): {} })).unwrap();
            assert_eq!(BaseCodingAgent::from(&coding), agent);
            match agent {
                BaseCodingAgent::ClaudeCode => {
                    assert_eq!(compat.cli.as_deref(), Some("claude_code"));
                    assert_eq!(compat.mcp, crate::plugins::InjectionSupport::Supported);
                    assert_eq!(compat.skills, crate::plugins::InjectionSupport::Supported);
                    assert!(
                        crate::mcp_registry::claude_config(&env.mcp_servers, None)
                            .contains("probe")
                    );
                }
                BaseCodingAgent::ClaudeCodeHeaded => {
                    assert_eq!(compat.cli.as_deref(), Some("claude_code"));
                    assert_eq!(compat.mcp, crate::plugins::InjectionSupport::Supported);
                    assert_eq!(compat.skills, crate::plugins::InjectionSupport::Supported);
                }
                BaseCodingAgent::Codex => {
                    assert_eq!(compat.cli.as_deref(), Some("codex"));
                    assert_eq!(compat.mcp, crate::plugins::InjectionSupport::Supported);
                    assert!(
                        crate::mcp_registry::codex_args(&env.mcp_servers)
                            .join(" ")
                            .contains("mcp_servers.probe")
                    );
                    assert_eq!(compat.skills, crate::plugins::InjectionSupport::Unsupported);
                }
                BaseCodingAgent::Opencode => {
                    assert_eq!(compat.cli.as_deref(), Some("opencode"));
                    assert!(
                        crate::mcp_registry::opencode_config(&env.mcp_servers, None)
                            .contains("probe")
                    );
                    assert!(
                        crate::plugins::opencode_skills_config(&env.skill_dirs, None)
                            .contains("/tmp/run-skills")
                    );
                }
                BaseCodingAgent::OpencodeHeaded => {
                    let exec: OpencodeHeaded = serde_json::from_str("{}").unwrap();
                    let prepared = exec.prepare_headed_env(&env);
                    assert!(prepared.vars["OPENCODE_CONFIG_CONTENT"].contains("probe"));
                    assert!(prepared.vars["OPENCODE_CONFIG_CONTENT"].contains("/tmp/run-skills"));
                }
                BaseCodingAgent::Gemini => {
                    assert_eq!(compat.cli.as_deref(), Some("gemini"));
                    assert_eq!(compat.mcp_mechanism, "GEMINI_CLI_SYSTEM_SETTINGS_PATH");
                    assert_eq!(
                        compat.skills,
                        crate::plugins::InjectionSupport::PromptCatalog
                    );
                    assert!(
                        crate::mcp_registry::gemini_family_settings(&env.mcp_servers, None, false)
                            .contains("probe")
                    );
                }
                BaseCodingAgent::QwenCode => {
                    assert_eq!(compat.cli.as_deref(), Some("qwen_code"));
                    assert_eq!(compat.mcp_mechanism, "QWEN_CODE_SYSTEM_SETTINGS_PATH");
                    assert_eq!(
                        compat.skills,
                        crate::plugins::InjectionSupport::PromptCatalog
                    );
                    assert!(
                        crate::mcp_registry::gemini_family_settings(&env.mcp_servers, None, true)
                            .contains("probe")
                    );
                }
                BaseCodingAgent::Amp => {
                    let exec: Amp = serde_json::from_str("{}").unwrap();
                    let args = exec
                        .build_command_builder(&env)
                        .unwrap()
                        .build_initial()
                        .unwrap();
                    assert!(
                        args.args()
                            .windows(2)
                            .any(|w| w[0] == "--mcp-config" && w[1].contains("probe"))
                    );
                    assert_eq!(
                        compat.skills,
                        crate::plugins::InjectionSupport::PromptCatalog
                    );
                }
                BaseCodingAgent::CursorAgent => {
                    let exec: CursorAgent = serde_json::from_str("{}").unwrap();
                    let args = exec
                        .build_command_builder(&env)
                        .unwrap()
                        .build_initial()
                        .unwrap();
                    assert!(
                        args.args()
                            .windows(2)
                            .any(|w| w == ["--plugin-dir", "/tmp/run-cfg"])
                    );
                }
                BaseCodingAgent::Copilot => {
                    let exec: Copilot = serde_json::from_str("{}").unwrap();
                    let args = exec
                        .build_command_builder(&env)
                        .unwrap()
                        .build_initial()
                        .unwrap();
                    assert!(
                        args.args()
                            .windows(2)
                            .any(|w| w[0] == "--additional-mcp-config" && w[1].contains("probe"))
                    );
                    assert!(
                        exec.with_skills_env(&env).vars["COPILOT_SKILLS_DIRS"]
                            .contains("/tmp/run-skills")
                    );
                }
                BaseCodingAgent::Droid => {
                    let exec: Droid = serde_json::from_str("{}").unwrap();
                    let args = exec
                        .build_command_builder(&env)
                        .unwrap()
                        .build_initial()
                        .unwrap();
                    assert!(
                        args.args()
                            .windows(2)
                            .any(|w| w == ["--settings", "/tmp/run-cfg"])
                    );
                    assert_eq!(
                        compat.skills,
                        crate::plugins::InjectionSupport::PromptCatalog
                    );
                }
                BaseCodingAgent::Antigravity => {
                    let exec: Antigravity = serde_json::from_str("{}").unwrap();
                    let args = exec
                        .build_command_builder(&env)
                        .unwrap()
                        .build_initial()
                        .unwrap();
                    assert!(
                        args.args()
                            .windows(2)
                            .any(|w| w == ["--add-dir", "/tmp/run-skills"])
                    );
                    assert_eq!(
                        compat.skills,
                        crate::plugins::InjectionSupport::Supported
                    );
                }
                #[cfg(feature = "qa-mode")]
                BaseCodingAgent::QaMock => {
                    assert_eq!(compat.mcp, crate::plugins::InjectionSupport::Unsupported);
                    assert_eq!(compat.skills, crate::plugins::InjectionSupport::Unsupported);
                }
            }
        }
    }

    #[test]
    fn test_cursor_agent_deserialization() {
        // Test that CURSOR_AGENT is accepted
        let result = BaseCodingAgent::from_str("CURSOR_AGENT");
        assert!(result.is_ok(), "CURSOR_AGENT should be valid");
        assert_eq!(result.unwrap(), BaseCodingAgent::CursorAgent);

        // Test that legacy CURSOR is still accepted for backwards compatibility
        let result = BaseCodingAgent::from_str("CURSOR");
        assert!(
            result.is_ok(),
            "CURSOR should be valid for backwards compatibility"
        );
        assert_eq!(result.unwrap(), BaseCodingAgent::CursorAgent);

        // Test serde deserialization for CURSOR_AGENT
        let result: Result<BaseCodingAgent, _> = serde_json::from_str(r#""CURSOR_AGENT""#);
        assert!(result.is_ok(), "CURSOR_AGENT should deserialize via serde");
        assert_eq!(result.unwrap(), BaseCodingAgent::CursorAgent);

        // Test serde deserialization for legacy CURSOR
        let result: Result<BaseCodingAgent, _> = serde_json::from_str(r#""CURSOR""#);
        assert!(result.is_ok(), "CURSOR should deserialize via serde");
        assert_eq!(result.unwrap(), BaseCodingAgent::CursorAgent);
    }
}
