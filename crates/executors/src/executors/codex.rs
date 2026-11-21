pub mod client;
pub mod jsonrpc;
pub mod normalize_logs;
pub mod review;
pub mod slash_commands;
use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
};

/// Returns the Codex home directory.
///
/// Checks the `CODEX_HOME` environment variable first, then falls back to `~/.codex`.
/// This allows users to configure a custom location for Codex configuration and state.
pub fn codex_home() -> Option<PathBuf> {
    if let Ok(codex_home) = env::var("CODEX_HOME")
        && !codex_home.trim().is_empty()
    {
        return Some(PathBuf::from(codex_home));
    }
    dirs::home_dir().map(|home| home.join(".codex"))
}

/// Write the bundled Codex model catalog to a HiveDeck-owned runtime path and
/// return the absolute path. Returns `None` if the file system is not writable,
/// allowing the agent to fall back to the default behavior.
fn materialize_static_model_catalog() -> Option<PathBuf> {
    const CATALOG: &str = include_str!("codex/models.json");

    let base = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join("hivedeck").join("runtime").join("codex");
    let path = dir.join("models-catalog.json");

    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }

    // Idempotent write; avoid touching the file if the catalog is already in
    // place and matches the bundled version.
    let existing_matches = std::fs::read_to_string(&path)
        .map(|existing| existing == CATALOG)
        .unwrap_or(false);
    if !existing_matches && std::fs::write(&path, CATALOG).is_err() {
        return None;
    }

    Some(path)
}

pub(crate) fn resolve_model(model: Option<&str>) -> (Option<&str>, bool) {
    match model.and_then(|m| m.strip_suffix("-fast")) {
        Some(base) => (Some(base), true),
        None => (model, false),
    }
}

pub(crate) fn fork_params_from(thread_id: String, params: ThreadStartParams) -> ThreadForkParams {
    ThreadForkParams {
        thread_id,
        model: params.model,
        model_provider: params.model_provider,
        cwd: params.cwd,
        approval_policy: params.approval_policy,
        sandbox: params.sandbox,
        config: params.config,
        base_instructions: params.base_instructions,
        developer_instructions: params.developer_instructions,
        service_tier: params.service_tier,
        ..Default::default()
    }
}

use async_trait::async_trait;
use codex_app_server_protocol::{
    AskForApproval as V2AskForApproval, ReviewTarget, SandboxMode as V2SandboxMode,
    ThreadForkParams, ThreadStartParams, UserInput,
};
use derivative::Derivative;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use strum_macros::{AsRefStr, EnumString};
use tokio::process::Command;
use ts_rs::TS;
use workspace_utils::{command_ext::GroupSpawnNoWindowExt, msg_store::MsgStore};

use self::{
    client::{AppServerClient, LogWriter},
    jsonrpc::{ExitSignalSender, JsonRpcPeer},
    normalize_logs::{Error, normalize_logs},
};
use crate::{
    approvals::ExecutorApprovalService,
    command::{CmdOverrides, CommandBuildError, CommandBuilder, CommandParts, apply_overrides},
    env::ExecutionEnv,
    executor_discovery::ExecutorDiscoveredOptions,
    executors::{
        AppendPrompt, AvailabilityInfo, BaseCodingAgent, ExecutorError, ExecutorExitResult,
        SlashCommandDescription, SpawnedChild, StandardCodingAgentExecutor,
    },
    logs::utils::patch,
    model_selector::{ModelInfo, ModelSelectorConfig, PermissionPolicy, ReasoningOption},
    profile::ExecutorConfig,
    stdout_dup::create_stdout_pipe_writer,
};

/// Sandbox policy modes for Codex
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, AsRefStr)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum SandboxMode {
    Auto,
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

/// Determines when the user is consulted to approve Codex actions.
///
/// - `UnlessTrusted`: Read-only commands are auto-approved. Everything else will
///   ask the user to approve.
/// - `OnFailure`: All commands run in a restricted sandbox initially. If a
///   command fails, the user is asked to approve execution without the sandbox.
/// - `OnRequest`: The model decides when to ask the user for approval.
/// - `Never`: Commands never ask for approval. Commands that fail in the
///   restricted sandbox are not retried.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, AsRefStr)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum AskForApproval {
    UnlessTrusted,
    OnFailure,
    OnRequest,
    Never,
}

/// Reasoning effort for the underlying model
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, AsRefStr, EnumString)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ReasoningEffort {
    Low,
    Medium,
    High,
    Xhigh,
}

/// Model reasoning summary style
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, AsRefStr)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ReasoningSummary {
    Auto,
    Concise,
    Detailed,
    None,
}

/// Format for model reasoning summaries
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, AsRefStr)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ReasoningSummaryFormat {
    None,
    Experimental,
}

enum CodexSessionAction {
    Chat { prompt: String },
    Review { target: ReviewTarget },
}

#[derive(Derivative, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[derivative(Debug, PartialEq)]
pub struct Codex {
    #[serde(default)]
    pub append_prompt: AppendPrompt,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox: Option<SandboxMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask_for_approval: Option<AskForApproval>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oss: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_effort: Option<ReasoningEffort>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_summary: Option<ReasoningSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_summary_format: Option<ReasoningSummaryFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_instructions: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_apply_patch_tool: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compact_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub developer_instructions: Option<String>,
    #[serde(default)]
    pub plan: bool,
    #[serde(flatten)]
    pub cmd: CmdOverrides,

    #[serde(skip)]
    #[ts(skip)]
    #[derivative(Debug = "ignore", PartialEq = "ignore")]
    approvals: Option<Arc<dyn ExecutorApprovalService>>,
}

#[async_trait]
impl StandardCodingAgentExecutor for Codex {
    fn apply_overrides(&mut self, executor_config: &ExecutorConfig) {
        if let Some(model_id) = &executor_config.model_id {
            self.model = Some(model_id.clone());
        }
        if let Some(reasoning_id) = &executor_config.reasoning_id
            && let Ok(reasoning_effort) = ReasoningEffort::from_str(reasoning_id)
        {
            self.model_reasoning_effort = Some(reasoning_effort)
        }
        if let Some(permission_policy) = &executor_config.permission_policy {
            match permission_policy {
                crate::model_selector::PermissionPolicy::Auto => {
                    self.ask_for_approval = Some(AskForApproval::Never);
                    self.plan = false;
                }
                crate::model_selector::PermissionPolicy::Supervised => {
                    if matches!(self.ask_for_approval, None | Some(AskForApproval::Never)) {
                        self.ask_for_approval = Some(AskForApproval::UnlessTrusted);
                    }
                    self.plan = false;
                }
                crate::model_selector::PermissionPolicy::Plan => {
                    self.plan = true;
                }
            }
        }
    }

    fn use_approvals(&mut self, approvals: Arc<dyn ExecutorApprovalService>) {
        self.approvals = Some(approvals);
    }

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn_slash_command(current_dir, prompt, None, env)
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
        self.spawn_slash_command(current_dir, prompt, Some(session_id), env)
            .await
    }

    fn normalize_logs(
        &self,
        msg_store: Arc<MsgStore>,
        worktree_path: &Path,
    ) -> Vec<tokio::task::JoinHandle<()>> {
        normalize_logs(msg_store, worktree_path)
    }

    fn default_mcp_config_path(&self) -> Option<PathBuf> {
        codex_home().map(|home| home.join("config.toml"))
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        if let Some(timestamp) = codex_home()
            .and_then(|home| std::fs::metadata(home.join("auth.json")).ok())
            .and_then(|m| m.modified().ok())
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
        {
            return AvailabilityInfo::LoginDetected {
                last_auth_timestamp: timestamp,
            };
        }

        let mcp_config_found = self
            .default_mcp_config_path()
            .map(|p| p.exists())
            .unwrap_or(false);

        let installation_indicator_found = codex_home()
            .map(|home| home.join("version.json").exists())
            .unwrap_or(false);

        if mcp_config_found || installation_indicator_found {
            AvailabilityInfo::InstallationFound
        } else {
            AvailabilityInfo::NotFound
        }
    }

    fn get_preset_options(&self) -> ExecutorConfig {
        use crate::model_selector::*;
        let permission_policy = if self.plan {
            PermissionPolicy::Plan
        } else if matches!(self.ask_for_approval, None | Some(AskForApproval::Never)) {
            PermissionPolicy::Auto
        } else {
            PermissionPolicy::Supervised
        };

        ExecutorConfig {
            executor: BaseCodingAgent::Codex,
            variant: None,
            model_id: self.model.clone(),
            agent_id: None,
            reasoning_id: self
                .model_reasoning_effort
                .as_ref()
                .map(|e| e.as_ref().to_string()),
            permission_policy: Some(permission_policy),
        }
    }

    async fn discover_options(
        &self,
        _workdir: Option<&std::path::Path>,
        _repo_path: Option<&std::path::Path>,
    ) -> Result<futures::stream::BoxStream<'static, json_patch::Patch>, ExecutorError> {
        let xhigh_reasoning_options = ReasoningOption::from_names(
            [
                ReasoningEffort::Low,
                ReasoningEffort::Medium,
                ReasoningEffort::High,
                ReasoningEffort::Xhigh,
            ]
            .map(|e| e.as_ref().to_string()),
        );

        let options = ExecutorDiscoveredOptions {
            model_selector: ModelSelectorConfig {
                models: vec![
                    ModelInfo {
                        id: "gpt-5.5".to_string(),
                        name: "GPT-5.5".to_string(),
                        provider_id: None,
                        reasoning_options: xhigh_reasoning_options.clone(),
                    },
                    ModelInfo {
                        id: "gpt-5.5-fast".to_string(),
                        name: "GPT-5.5 Fast".to_string(),
                        provider_id: None,
                        reasoning_options: xhigh_reasoning_options.clone(),
                    },
                    ModelInfo {
                        id: "gpt-5.4".to_string(),
                        name: "GPT-5.4".to_string(),
                        provider_id: None,
                        reasoning_options: xhigh_reasoning_options.clone(),
                    },
                    ModelInfo {
                        id: "gpt-5.4-fast".to_string(),
                        name: "GPT-5.4 Fast".to_string(),
                        provider_id: None,
                        reasoning_options: xhigh_reasoning_options.clone(),
                    },
                    ModelInfo {
                        id: "gpt-5.4-mini".to_string(),
                        name: "GPT-5.4 Mini".to_string(),
                        provider_id: None,
                        reasoning_options: xhigh_reasoning_options.clone(),
                    },
                    ModelInfo {
                        id: "gpt-5.3-codex".to_string(),
                        name: "GPT-5.3 Codex".to_string(),
                        provider_id: None,
                        reasoning_options: xhigh_reasoning_options.clone(),
                    },
                    ModelInfo {
                        id: "gpt-5.3-codex-spark".to_string(),
                        name: "GPT-5.3 Codex Spark".to_string(),
                        provider_id: None,
                        reasoning_options: xhigh_reasoning_options.clone(),
                    },
                    ModelInfo {
                        id: "gpt-5.2".to_string(),
                        name: "GPT-5.2".to_string(),
                        provider_id: None,
                        reasoning_options: xhigh_reasoning_options,
                    },
                ],
                permissions: vec![
                    PermissionPolicy::Auto,
                    PermissionPolicy::Supervised,
                    PermissionPolicy::Plan,
                ],
                ..Default::default()
            },
            slash_commands: vec![
                SlashCommandDescription {
                    name: "compact".to_string(),
                    description: Some(
                        "summarize conversation to prevent hitting the context limit".to_string(),
                    ),
                },
                SlashCommandDescription {
                    name: "init".to_string(),
                    description: Some(
                        "create an AGENTS.md file with instructions for Codex".to_string(),
                    ),
                },
                SlashCommandDescription {
                    name: "status".to_string(),
                    description: Some(
                        "show current session configuration and token usage".to_string(),
                    ),
                },
                SlashCommandDescription {
                    name: "mcp".to_string(),
                    description: Some("list configured MCP tools".to_string()),
                },
                SlashCommandDescription {
                    name: "model".to_string(),
                    description: Some("view or switch the active model".to_string()),
                },
                SlashCommandDescription {
                    name: "fast".to_string(),
                    description: Some(
                        "toggle fast mode for highest speed inference (2× plan usage). Use `/fast on` or `/fast off` to set explicitly".to_string(),
                    ),
                },
            ],
            ..Default::default()
        };
        Ok(Box::pin(futures::stream::once(async move {
            patch::executor_discovered_options(options)
        })))
    }

    async fn spawn_review(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let command_parts = self.build_command_builder()?.build_initial()?;
        let review_target = ReviewTarget::Custom {
            instructions: prompt.to_string(),
        };
        let action = CodexSessionAction::Review {
            target: review_target,
        };
        self.spawn_inner(current_dir, command_parts, action, session_id, env)
            .await
    }
}

/// Env var through which the host routes a Codex run through a local
/// OpenAI-compatible router (the embedded 9router, ADR-028). Its value is the
/// router's `/v1` base URL. Turned into root-level `-c` config overrides that
/// declare a custom provider and make it the default, so the app server (and
/// its account check) talks to the router. Not forwarded to the process.
pub const ROUTER_BASE_URL_ENV: &str = "HIVEDECK_CODEX_ROUTER_BASE_URL";
/// Provider id HiveDeck declares for the router.
pub const ROUTER_PROVIDER_ID: &str = "hivedeck_9router";

/// ADR-031: a Codex run acting as the HiveDeck captain. The container sets
/// these; Codex turns them into an MCP server entry and developer
/// instructions, and strips them from the child's environment.
pub const CAPTAIN_MCP_URL_ENV: &str = "HIVEDECK_CODEX_CAPTAIN_MCP_URL";
pub const CAPTAIN_INSTRUCTIONS_ENV: &str = "HIVEDECK_CODEX_CAPTAIN_INSTRUCTIONS";
/// Name of the MCP server entry the captain's tools are served under.
pub const CAPTAIN_MCP_SERVER: &str = "hivedeck";

/// `-c` override that registers HiveDeck's streamable-HTTP MCP endpoint.
pub fn captain_mcp_args(url: &str) -> Vec<String> {
    let url = url.replace(['"', '\\'], "");
    vec![
        "-c".to_string(),
        format!("mcp_servers.{CAPTAIN_MCP_SERVER}.url=\"{url}\""),
    ]
}

/// Prepend the captain's manual to any profile-level developer instructions.
fn with_captain_instructions(existing: Option<String>, captain: &str) -> String {
    match existing.filter(|d| !d.trim().is_empty()) {
        Some(d) => format!("{captain}\n\n{d}"),
        None => captain.to_string(),
    }
}

/// `-c` overrides that point Codex at the router at `base_url`.
pub fn router_config_args(base_url: &str) -> Vec<String> {
    let url = base_url.replace(['"', '\\'], "");
    vec![
        "-c".to_string(),
        format!("model_provider=\"{ROUTER_PROVIDER_ID}\""),
        "-c".to_string(),
        format!(
            "model_providers.{ROUTER_PROVIDER_ID}={{name=\"9router\",base_url=\"{url}\",wire_api=\"responses\"}}"
        ),
    ]
}

/// Whether a Codex run already has a model chosen: a per-run override or
/// the profile's own `model`.
pub fn has_explicit_model(config: &ExecutorConfig) -> bool {
    if config
        .model_id
        .as_deref()
        .is_some_and(|m| !m.trim().is_empty())
    {
        return true;
    }
    matches!(
        crate::profile::ExecutorConfigs::get_cached().get_coding_agent(&config.profile_id()),
        Some(crate::executors::CodingAgent::Codex(c)) if c.model.as_deref().is_some_and(|m| !m.trim().is_empty())
    )
}

impl Codex {
    pub fn base_command() -> &'static str {
        "npx -y @openai/codex@0.152.1"
    }

    /// Static model catalog (verbatim from the pinned Codex `rust-v0.152.1`
    /// checkout, `codex-rs/models-manager/models.json`). Passed to the
    /// app-server via `-c model_catalog_json=<path>` so Codex uses
    /// `StaticModelsManager` instead of fetching `/models` from the model
    /// provider. Custom providers backed by OpenAI-compatible routers (e.g.
    /// 9router) return an OpenAI `{ "data": [...] }` list, which fails Codex's
    /// `ModelsResponse { models }` decode and logs
    /// `failed to refresh available models` on every spawn.
    ///
    /// The flag goes before `app-server`, with the other root-level `-c`
    /// overrides (9router routing, the captain's MCP server): `-c` flags
    /// given to the subcommand replace the root-level ones, so a catalog flag
    /// after `app-server` silently dropped `model_provider` and sent combo
    /// names like "planner" to ChatGPT.
    fn build_command_builder(&self) -> Result<CommandBuilder, CommandBuildError> {
        let mut builder = CommandBuilder::new(Self::base_command());
        if let Some(catalog_path) = materialize_static_model_catalog() {
            builder = builder.extend_params([
                "-c".to_string(),
                format!(
                    "model_catalog_json={}",
                    toml::Value::String(catalog_path.display().to_string())
                ),
            ]);
        }
        builder = builder.extend_params(["app-server"]);
        if self.oss.unwrap_or(false) {
            builder = builder.extend_params(["--oss"]);
        }

        apply_overrides(builder, &self.cmd)
    }

    fn build_thread_start_params(&self, cwd: &Path) -> ThreadStartParams {
        let sandbox = match self.sandbox.as_ref() {
            None | Some(SandboxMode::Auto) => Some(V2SandboxMode::WorkspaceWrite), // match the Auto preset in codex
            Some(SandboxMode::ReadOnly) => Some(V2SandboxMode::ReadOnly),
            Some(SandboxMode::WorkspaceWrite) => Some(V2SandboxMode::WorkspaceWrite),
            Some(SandboxMode::DangerFullAccess) => Some(V2SandboxMode::DangerFullAccess),
        };

        let approval_policy = match self.ask_for_approval.as_ref() {
            None if matches!(self.sandbox.as_ref(), None | Some(SandboxMode::Auto)) => {
                // match the Auto preset in codex
                Some(V2AskForApproval::OnRequest)
            }
            None => None,
            Some(AskForApproval::UnlessTrusted) => Some(V2AskForApproval::UnlessTrusted),
            // 0.152.1 renamed OnFailure -> OnRequest (serde alias "on-failure")
            Some(AskForApproval::OnFailure) => Some(V2AskForApproval::OnRequest),
            Some(AskForApproval::OnRequest) => Some(V2AskForApproval::OnRequest),
            Some(AskForApproval::Never) => Some(V2AskForApproval::Never),
        };

        let mut config = self.build_config_overrides();
        // V1 top-level params that moved into config overrides in v2
        if let Some(profile) = &self.profile {
            config
                .get_or_insert_with(HashMap::new)
                .insert("profile".to_string(), Value::String(profile.clone()));
        }
        if let Some(include) = self.include_apply_patch_tool {
            config
                .get_or_insert_with(HashMap::new)
                .insert("include_apply_patch_tool".to_string(), Value::Bool(include));
        }
        if let Some(compact) = &self.compact_prompt {
            config
                .get_or_insert_with(HashMap::new)
                .insert("compact_prompt".to_string(), Value::String(compact.clone()));
        }
        if !matches!(approval_policy, None | Some(V2AskForApproval::Never)) {
            let map = config.get_or_insert_with(HashMap::new);
            map.insert(
                "features.default_mode_request_user_input".to_string(),
                Value::Bool(true),
            );
            map.insert(
                "suppress_unstable_features_warning".to_string(),
                Value::Bool(true),
            );
        }

        let (model, is_fast) = resolve_model(self.model.as_deref());
        let service_tier = if is_fast {
            Some(Some("fast".to_string()))
        } else {
            None
        };

        ThreadStartParams {
            model: model.map(|m| m.to_string()),
            cwd: Some(cwd.to_string_lossy().to_string()),
            approval_policy,
            sandbox,
            config,
            base_instructions: self.base_instructions.clone(),
            model_provider: self.model_provider.clone(),
            developer_instructions: self.developer_instructions.clone(),
            service_tier,
            ..Default::default()
        }
    }

    fn build_config_overrides(&self) -> Option<HashMap<String, Value>> {
        let mut overrides = HashMap::new();

        if let Some(effort) = &self.model_reasoning_effort {
            overrides.insert(
                "model_reasoning_effort".to_string(),
                Value::String(effort.as_ref().to_string()),
            );
        }

        if let Some(summary) = &self.model_reasoning_summary {
            overrides.insert(
                "model_reasoning_summary".to_string(),
                Value::String(summary.as_ref().to_string()),
            );
        }

        if let Some(format) = &self.model_reasoning_summary_format
            && format != &ReasoningSummaryFormat::None
        {
            overrides.insert(
                "model_reasoning_summary_format".to_string(),
                Value::String(format.as_ref().to_string()),
            );
        }

        if overrides.is_empty() {
            None
        } else {
            Some(overrides)
        }
    }

    fn prepare_mcp_env(
        &self,
        current_dir: &Path,
        command_parts: &CommandParts,
        env: &ExecutionEnv,
    ) -> (ExecutionEnv, Vec<String>) {
        let mut env = env.clone();
        let registry_variables: std::collections::HashSet<_> = env
            .mcp_servers
            .iter()
            .flat_map(|server| server.headers.values().chain(server.env.values()))
            .cloned()
            .collect();
        let effective = env.clone().with_profile(&self.cmd);
        let home = effective
            .get("CODEX_HOME")
            .cloned()
            .or_else(|| std::env::var("CODEX_HOME").ok())
            .filter(|path| !path.trim().is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                effective
                    .get("HOME")
                    .map(|home| PathBuf::from(home).join(".codex"))
            })
            .or_else(codex_home);
        let mut paths: Vec<PathBuf> = current_dir
            .ancestors()
            .map(|dir| dir.join(".codex/config.toml"))
            .collect();
        if let Some(home) = home {
            paths.push(home.join("config.toml"));
            paths.push(home.join("managed_config.toml"));
        } else if !env.mcp_servers.is_empty() {
            tracing::warn!("Skipping Codex registry servers: Codex home is unknown");
            env.mcp_servers.clear();
        }
        #[cfg(unix)]
        paths.push(PathBuf::from("/etc/codex/managed_config.toml"));
        let disabled_registry_names = crate::mcp_registry::filter_codex_conflicts(
            &mut env.mcp_servers,
            &paths,
            command_parts.args(),
        );
        let retained_variables: std::collections::HashSet<_> = env
            .mcp_servers
            .iter()
            .flat_map(|server| server.headers.values().chain(server.env.values()))
            .cloned()
            .collect();
        for variable in registry_variables.difference(&retained_variables) {
            env.vars.remove(variable);
        }
        (env, disabled_registry_names)
    }

    fn codex_extension_overrides(env: &ExecutionEnv) -> Vec<(String, Value)> {
        let mut prefs = crate::extensions::ExtensionPrefs::load().for_cli("CODEX");
        for server in &env.mcp_servers {
            prefs.disabled_mcp.remove(&server.name);
        }
        crate::extensions::codex_config_overrides(&prefs)
    }

    async fn spawn_inner(
        &self,
        current_dir: &Path,
        command_parts: CommandParts,
        action: CodexSessionAction,
        resume_session: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let (env, disabled_registry_names) = self.prepare_mcp_env(current_dir, &command_parts, env);
        let mut params = self.build_thread_start_params(current_dir);
        if let Some(captain) = env.vars.get(CAPTAIN_INSTRUCTIONS_ENV) {
            params.developer_instructions = Some(with_captain_instructions(
                params.developer_instructions.take(),
                captain,
            ));
        }
        // The owner's per-CLI choices for headless runs (ADR-038).
        for (key, value) in Self::codex_extension_overrides(&env) {
            params
                .config
                .get_or_insert_with(HashMap::new)
                .insert(key, value);
        }
        let resume_session = resume_session.map(|s| s.to_string());

        self.spawn_app_server(
            current_dir,
            command_parts,
            &env,
            &disabled_registry_names,
            move |client, _| async move {
                match action {
                    CodexSessionAction::Chat { prompt } => {
                        Self::launch_codex_agent(params, resume_session, prompt, client).await
                    }
                    CodexSessionAction::Review { target } => {
                        review::launch_codex_review(params, resume_session, target, client).await
                    }
                }
            },
        )
        .await
    }

    async fn launch_codex_agent(
        thread_start_params: ThreadStartParams,
        resume_session: Option<String>,
        combined_prompt: String,
        client: Arc<AppServerClient>,
    ) -> Result<(), ExecutorError> {
        let account = client.get_account().await?;
        if account.requires_openai_auth && account.account.is_none() {
            return Err(ExecutorError::AuthRequired(
                "Codex authentication required".to_string(),
            ));
        }

        let (thread_id, resolved_model) = match resume_session {
            None => {
                let response = client.thread_start(thread_start_params).await?;
                (response.thread.id, response.model)
            }
            Some(session_id) => {
                let response = client
                    .thread_fork(fork_params_from(session_id, thread_start_params))
                    .await?;
                tracing::debug!("forked thread, new thread_id={}", response.thread.id);
                (response.thread.id, response.model)
            }
        };

        client.set_resolved_model(resolved_model);
        client.register_session(&thread_id).await?;
        let collaboration_mode = client.initial_collaboration_mode()?;
        client
            .turn_start_with_mode(
                thread_id,
                vec![UserInput::Text {
                    text: combined_prompt,
                    text_elements: vec![],
                }],
                Some(collaboration_mode),
            )
            .await?;

        Ok(())
    }

    /// Common boilerplate for spawning a Codex app server process
    /// Handles process spawning, stdout/stderr piping, exit signal handling, client initialization, and error logging.
    /// Delegates the actual Codex session logic to the provided `task` closure.
    async fn spawn_app_server<F, Fut>(
        &self,
        current_dir: &Path,
        command_parts: CommandParts,
        env: &ExecutionEnv,
        disabled_registry_names: &[String],
        task: F,
    ) -> Result<SpawnedChild, ExecutorError>
    where
        F: FnOnce(Arc<AppServerClient>, ExitSignalSender) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = Result<(), ExecutorError>> + Send + 'static,
    {
        let (program_path, mut args) = command_parts.into_resolved().await?;
        if let Some(base_url) = env.vars.get(ROUTER_BASE_URL_ENV) {
            // Root-level overrides go before the subcommand.
            let at = args
                .iter()
                .position(|a| a == "app-server")
                .unwrap_or(args.len());
            args.splice(at..at, router_config_args(base_url));
        }
        if let Some(url) = env.vars.get(CAPTAIN_MCP_URL_ENV) {
            let at = args
                .iter()
                .position(|a| a == "app-server")
                .unwrap_or(args.len());
            args.splice(at..at, captain_mcp_args(url));
        }
        let at = args
            .iter()
            .position(|arg| arg == "app-server")
            .unwrap_or(args.len());
        args.splice(at..at, crate::mcp_registry::codex_args(&env.mcp_servers));
        let at = args
            .iter()
            .position(|arg| arg == "app-server")
            .unwrap_or(args.len());
        args.splice(
            at..at,
            crate::mcp_registry::codex_disable_args(disabled_registry_names),
        );
        let ext_args: Vec<String> = Self::codex_extension_overrides(env)
            .into_iter()
            .flat_map(|(key, value)| ["-c".to_string(), format!("{key}={value}")])
            .collect();
        if !ext_args.is_empty() {
            let at = args
                .iter()
                .position(|arg| arg == "app-server")
                .unwrap_or(args.len());
            args.splice(at..at, ext_args);
        }

        let mut process = Command::new(program_path);
        process
            .kill_on_drop(true)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .current_dir(current_dir)
            .env("NPM_CONFIG_LOGLEVEL", "error")
            .env("NODE_NO_WARNINGS", "1")
            .env("NO_COLOR", "1")
            .env("RUST_LOG", "error")
            .args(&args);

        env.clone()
            .with_profile(&self.cmd)
            .apply_to_command(&mut process);
        for server in &env.mcp_servers {
            for (name, variable) in &server.env {
                if let Some(value) = env.vars.get(variable) {
                    process.env(name, value);
                }
            }
        }
        process.env_remove(ROUTER_BASE_URL_ENV);
        process.env_remove(CAPTAIN_MCP_URL_ENV);
        process.env_remove(CAPTAIN_INSTRUCTIONS_ENV);

        let mut child = process.group_spawn_no_window()?;

        let child_stdout = child.inner().stdout.take().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other("Codex app server missing stdout"))
        })?;
        let child_stdin = child.inner().stdin.take().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other("Codex app server missing stdin"))
        })?;

        let new_stdout = create_stdout_pipe_writer(&mut child)?;
        let (exit_signal_tx, exit_signal_rx) = tokio::sync::oneshot::channel();
        let cancel = tokio_util::sync::CancellationToken::new();

        let auto_approve = matches!(
            (&self.sandbox, &self.ask_for_approval),
            (Some(SandboxMode::DangerFullAccess), None)
        );
        let plan_mode = self.plan;
        let approvals = self.approvals.clone();
        let repo_context = env.repo_context.clone();
        let commit_reminder = env.commit_reminder;
        let commit_reminder_prompt = env.commit_reminder_prompt.clone();
        let cancel_for_task = cancel.clone();

        tokio::spawn(async move {
            let exit_signal_tx = ExitSignalSender::new(exit_signal_tx);
            let log_writer = LogWriter::new(new_stdout);

            // Initialize the AppServerClient
            let client = AppServerClient::new(
                log_writer.clone(),
                approvals,
                auto_approve,
                plan_mode,
                repo_context,
                commit_reminder,
                commit_reminder_prompt,
                cancel_for_task.clone(),
            );
            let rpc_peer = JsonRpcPeer::spawn(
                child_stdin,
                child_stdout,
                client.clone(),
                exit_signal_tx.clone(),
                cancel_for_task,
            );
            client.connect(rpc_peer);

            let result = async {
                client.initialize().await?;
                task(client, exit_signal_tx.clone()).await
            }
            .await;

            if let Err(err) = result {
                match &err {
                    ExecutorError::Io(io_err)
                        if io_err.kind() == std::io::ErrorKind::BrokenPipe =>
                    {
                        // Broken pipe likely means the parent process exited, so we can ignore it
                        return;
                    }
                    ExecutorError::AuthRequired(message) => {
                        log_writer
                            .log_raw(&Error::auth_required(message.clone()).raw())
                            .await
                            .ok();
                        exit_signal_tx
                            .send_exit_signal(ExecutorExitResult::Failure)
                            .await;
                        return;
                    }
                    _ => {
                        tracing::error!("Codex spawn error: {}", err);
                        log_writer
                            .log_raw(&Error::launch_error(err.to_string()).raw())
                            .await
                            .ok();
                    }
                }
                exit_signal_tx
                    .send_exit_signal(ExecutorExitResult::Failure)
                    .await;
            }
        });

        Ok(SpawnedChild {
            child,
            exit_signal: Some(exit_signal_rx),
            cancel: Some(cancel),
        })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn router_args_declare_and_select_provider() {
        let args = super::router_config_args("http://127.0.0.1:20128/v1");
        assert_eq!(args[0], "-c");
        assert_eq!(args[1], "model_provider=\"hivedeck_9router\"");
        assert!(args[3].starts_with("model_providers.hivedeck_9router={"));
        assert!(args[3].contains("base_url=\"http://127.0.0.1:20128/v1\""));
        assert!(args[3].contains("wire_api=\"responses\""));
    }

    #[test]
    fn captain_mcp_args_register_streamable_http_server() {
        let args = super::captain_mcp_args("http://127.0.0.1:3002/mcp");
        assert_eq!(
            args,
            vec![
                "-c".to_string(),
                "mcp_servers.hivedeck.url=\"http://127.0.0.1:3002/mcp\"".to_string(),
            ]
        );
    }

    #[test]
    fn captain_instructions_come_first() {
        assert_eq!(super::with_captain_instructions(None, "CAPTAIN"), "CAPTAIN");
        assert_eq!(
            super::with_captain_instructions(Some("profile".into()), "CAPTAIN"),
            "CAPTAIN\n\nprofile"
        );
        assert_eq!(
            super::with_captain_instructions(Some("  ".into()), "CAPTAIN"),
            "CAPTAIN"
        );
    }

    use super::{materialize_static_model_catalog, resolve_model};
    use codex_protocol::openai_models::ModelsResponse;

    #[test]
    fn resolve_model_detects_fast_suffix() {
        assert_eq!(resolve_model(Some("gpt-5.5-fast")), (Some("gpt-5.5"), true));
        assert_eq!(resolve_model(Some("gpt-5.4-fast")), (Some("gpt-5.4"), true));
    }

    #[test]
    fn resolve_model_leaves_non_fast_models_unchanged() {
        assert_eq!(resolve_model(Some("gpt-5.5")), (Some("gpt-5.5"), false));
        assert_eq!(
            resolve_model(Some("gpt-5.4-mini")),
            (Some("gpt-5.4-mini"), false)
        );
        assert_eq!(resolve_model(None), (None, false));
    }

    /// ponytail: strict schema test would be even stronger, but deserializing
    /// through the exact pinned decoder is the minimal regression check that
    /// proves the catalog we ship is valid. Add a live spawn test only after
    /// we have a lightweight way to assert `StaticModelsManager` is selected.
    #[test]
    fn bundled_catalog_deserializes_through_pinned_codex_decoder() {
        let path = materialize_static_model_catalog()
            .expect("catalog should materialize in a writable test environment");
        let bytes = std::fs::read_to_string(&path).unwrap();
        let decoded: ModelsResponse = serde_json::from_str(&bytes)
            .expect("bundled catalog must match Codex 0.152.1 ModelsResponse");
        assert!(
            !decoded.models.is_empty(),
            "catalog must contain at least one model"
        );
        // Sanity-check that the models HiveDeck advertises are in the catalog.
        let ids: std::collections::HashSet<&str> =
            decoded.models.iter().map(|m| m.slug.as_str()).collect();
        assert!(ids.contains("gpt-5.5"));
        assert!(ids.contains("gpt-5.4-mini"));
        assert!(ids.contains("gpt-5.2"));
    }
}
