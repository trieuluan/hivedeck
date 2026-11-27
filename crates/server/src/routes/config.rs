use std::collections::HashMap;

use axum::{
    Json, Router,
    body::Body,
    extract::{Path, Query, State, ws::Message},
    http,
    response::{IntoResponse, Json as ResponseJson, Response},
    routing::{get, post, put},
};
use deployment::{Deployment, DeploymentError};
use executors::{
    executors::{
        AvailabilityInfo, BaseAgentCapability, BaseCodingAgent, StandardCodingAgentExecutor,
    },
    profile::{ExecutorConfigs, ExecutorProfileId},
};
use serde::{Deserialize, Serialize};
use services::services::{
    config::{
        Config, SoundFile,
        editor::{EditorConfig, EditorType},
        save_config_to_file,
    },
    container::ContainerService,
    project_config,
};
use ts_rs::TS;
use utils::{assets::config_path, log_msg::LogMsg, response::ApiResponse};
use uuid::Uuid;

mod marketplace;

use crate::{
    DeploymentImpl,
    error::ApiError,
    middleware::signed_ws::{MaybeSignedWebSocket, SignedWsUpgrade},
};

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/info", get(get_user_system_info))
        .route("/config", put(update_config))
        .route("/sounds/{sound}", get(get_sound))
        .route(
            "/agent-extensions",
            get(get_agent_extensions).put(update_agent_extensions),
        )
        .route("/agent-extensions/marketplace", get(marketplace::catalog))
        .route("/profiles", get(get_profiles).put(update_profiles))
        .route("/export", get(export_config))
        .route("/import", post(import_config))
        .route(
            "/editors/check-availability",
            get(check_editor_availability),
        )
        .route("/agents/check-availability", get(check_agent_availability))
        .route("/agents/cli-status", get(get_cli_statuses))
        .route("/agents/cli-install", post(install_cli))
        .route("/agents/cli-login", post(login_cli))
        .route("/agents/preset-options", get(get_agent_preset_options))
        .route(
            "/agents/discovered-options/ws",
            get(stream_executor_discovered_options_ws),
        )
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct Environment {
    pub os_type: String,
    pub os_version: String,
    pub os_architecture: String,
    pub bitness: String,
}

impl Default for Environment {
    fn default() -> Self {
        Self::new()
    }
}

impl Environment {
    pub fn new() -> Self {
        let info = os_info::get();
        Environment {
            os_type: info.os_type().to_string(),
            os_version: info.version().to_string(),
            os_architecture: info.architecture().unwrap_or("unknown").to_string(),
            bitness: info.bitness().to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct UserSystemInfo {
    pub version: String,
    pub config: Config,
    #[serde(flatten)]
    pub profiles: ExecutorConfigs,
    pub environment: Environment,
    /// Capabilities supported per executor (e.g., { "CLAUDE_CODE": ["SESSION_FORK"] })
    pub capabilities: HashMap<String, Vec<BaseAgentCapability>>,
    pub preview_proxy_port: Option<u16>,
}

// TODO: update frontend, BE schema has changed, this replaces GET /config and /config/constants
#[axum::debug_handler]
async fn get_user_system_info(
    State(deployment): State<DeploymentImpl>,
) -> ResponseJson<ApiResponse<UserSystemInfo>> {
    let config = deployment.config().read().await.clone();

    let user_system_info = UserSystemInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        config,
        profiles: ExecutorConfigs::get_cached(),
        environment: Environment::new(),
        capabilities: {
            let mut caps: HashMap<String, Vec<BaseAgentCapability>> = HashMap::new();
            let profs = ExecutorConfigs::get_cached();
            for key in profs.executors.keys() {
                if let Some(agent) = profs.get_coding_agent(&ExecutorProfileId::new(*key)) {
                    caps.insert(key.to_string(), agent.capabilities());
                }
            }
            caps
        },
        preview_proxy_port: deployment.client_info().get_preview_proxy_port(),
    };

    ResponseJson(ApiResponse::success(user_system_info))
}

async fn update_config(
    State(deployment): State<DeploymentImpl>,
    Json(new_config): Json<Config>,
) -> ResponseJson<ApiResponse<Config>> {
    let config_path = config_path();

    // Validate git branch prefix
    if !git::is_valid_branch_prefix(&new_config.git_branch_prefix) {
        return ResponseJson(ApiResponse::error(
            "Invalid git branch prefix. Must be a valid git branch name component without slashes.",
        ));
    }

    // Get old config state before updating
    let _old_config = deployment.config().read().await.clone();

    match save_config_to_file(&new_config, &config_path).await {
        Ok(_) => {
            {
                let mut config = deployment.config().write().await;
                *config = new_config.clone();
            } // tokio write-lock released here

            // Hot-reload the origin-check middleware cache with the new list.
            // An empty list resets the cache to the VK_ALLOWED_ORIGINS env seed.
            // Done AFTER the tokio config lock is released so the std RwLock
            // write never blocks an async worker thread while holding it.
            crate::middleware::origin::set_allowed_origins(&new_config.allowed_origins);

            // Track config events when fields transition from false → true and run side effects

            ResponseJson(ApiResponse::success(new_config))
        }
        Err(e) => ResponseJson(ApiResponse::error(&format!("Failed to save config: {}", e))),
    }
}

async fn get_sound(Path(sound): Path<SoundFile>) -> Result<Response, ApiError> {
    let sound = sound.serve().await.map_err(DeploymentError::Other)?;
    let response = Response::builder()
        .status(http::StatusCode::OK)
        .header(
            http::header::CONTENT_TYPE,
            http::HeaderValue::from_static("audio/wav"),
        )
        .body(Body::from(sound.data.into_owned()))
        .unwrap();
    Ok(response)
}

/// One CLI's installed skills/MCP/hooks/plugins plus the owner's choices
/// for HiveDeck's headless runs (ADR-038).
#[derive(Debug, Serialize, TS)]
pub struct AgentExtensionsEntry {
    pub inventory: executors::extensions::CliInventory,
    pub prefs: executors::extensions::CliExtensionPrefs,
}

#[derive(Debug, Serialize, TS)]
pub struct AgentExtensionsResponse {
    pub clis: Vec<AgentExtensionsEntry>,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateAgentExtensionsRequest {
    pub cli: String,
    pub prefs: executors::extensions::CliExtensionPrefs,
}

async fn get_agent_extensions() -> ResponseJson<ApiResponse<AgentExtensionsResponse>> {
    let saved = executors::extensions::ExtensionPrefs::load();
    let clis = executors::extensions::SUPPORTED_CLIS
        .iter()
        .filter_map(|cli| {
            Some(AgentExtensionsEntry {
                inventory: executors::extensions::inventory(cli)?,
                prefs: saved.for_cli(cli),
            })
        })
        .collect();
    ResponseJson(ApiResponse::success(AgentExtensionsResponse { clis }))
}

async fn update_agent_extensions(
    Json(req): Json<UpdateAgentExtensionsRequest>,
) -> Result<ResponseJson<ApiResponse<executors::extensions::CliExtensionPrefs>>, ApiError> {
    if !executors::extensions::SUPPORTED_CLIS.contains(&req.cli.as_str()) {
        return Ok(ResponseJson(ApiResponse::error("Unsupported CLI")));
    }
    executors::extensions::ExtensionPrefs::set_cli(&req.cli, req.prefs.clone())
        .map_err(|e| ApiError::BadRequest(format!("could not save: {e}")))?;
    Ok(ResponseJson(ApiResponse::success(req.prefs)))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfilesContent {
    pub content: String,
    pub path: String,
}

async fn get_profiles(
    State(_deployment): State<DeploymentImpl>,
) -> ResponseJson<ApiResponse<ProfilesContent>> {
    let profiles_path = utils::assets::profiles_path();

    // Use cached data to ensure consistency with runtime and PUT updates
    let profiles = ExecutorConfigs::get_cached();

    let content = serde_json::to_string_pretty(&profiles).unwrap_or_else(|e| {
        tracing::error!("Failed to serialize profiles to JSON: {}", e);
        serde_json::to_string_pretty(&ExecutorConfigs::from_defaults())
            .unwrap_or_else(|_| "{}".to_string())
    });

    ResponseJson(ApiResponse::success(ProfilesContent {
        content,
        path: profiles_path.display().to_string(),
    }))
}

async fn update_profiles(
    State(_deployment): State<DeploymentImpl>,
    body: String,
) -> ResponseJson<ApiResponse<String>> {
    // Try to parse as ExecutorProfileConfigs format
    match serde_json::from_str::<ExecutorConfigs>(&body) {
        Ok(executor_profiles) => {
            // Save the profiles to file
            match executor_profiles.save_overrides() {
                Ok(_) => {
                    tracing::info!("Executor profiles saved successfully");
                    // Reload the cached profiles
                    ExecutorConfigs::reload();
                    ResponseJson(ApiResponse::success(
                        "Executor profiles updated successfully".to_string(),
                    ))
                }
                Err(e) => {
                    tracing::error!("Failed to save executor profiles: {}", e);
                    ResponseJson(ApiResponse::error(&format!(
                        "Failed to save executor profiles: {}",
                        e
                    )))
                }
            }
        }
        Err(e) => ResponseJson(ApiResponse::error(&format!(
            "Invalid executor profiles format: {}",
            e
        ))),
    }
}

#[derive(Debug, Serialize)]
pub struct ConfigExport {
    /// The exported config as a TOML document.
    pub content: String,
}

/// `GET /api/config/export` — serialise the static project/repo/agent config
/// (projects, repos, links, kanban columns, executor profiles) to TOML.
async fn export_config(
    State(deployment): State<DeploymentImpl>,
) -> ResponseJson<ApiResponse<ConfigExport>> {
    match project_config::export_to_string(&deployment.db().pool).await {
        Ok(content) => ResponseJson(ApiResponse::success(ConfigExport { content })),
        Err(e) => ResponseJson(ApiResponse::error(&format!("Export failed: {e}"))),
    }
}

/// `POST /api/config/import` — non-destructively upsert a TOML config document
/// (request body) into the DB and apply any embedded executor profiles.
async fn import_config(
    State(deployment): State<DeploymentImpl>,
    body: String,
) -> ResponseJson<ApiResponse<project_config::ImportSummary>> {
    match project_config::import_from_str(&deployment.db().pool, &body).await {
        Ok(summary) => ResponseJson(ApiResponse::success(summary)),
        Err(e) => ResponseJson(ApiResponse::error(&format!("Import failed: {e}"))),
    }
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct CheckEditorAvailabilityQuery {
    editor_type: EditorType,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct CheckEditorAvailabilityResponse {
    available: bool,
}

async fn check_editor_availability(
    State(_deployment): State<DeploymentImpl>,
    Query(query): Query<CheckEditorAvailabilityQuery>,
) -> ResponseJson<ApiResponse<CheckEditorAvailabilityResponse>> {
    // Construct a minimal EditorConfig for checking
    let editor_config = EditorConfig::new(
        query.editor_type,
        None,  // custom_command
        None,  // remote_ssh_host
        None,  // remote_ssh_user
        false, // auto_install_extension
    );

    let available = editor_config.check_availability().await;
    ResponseJson(ApiResponse::success(CheckEditorAvailabilityResponse {
        available,
    }))
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct CheckAgentAvailabilityQuery {
    executor: BaseCodingAgent,
}

async fn check_agent_availability(
    State(_deployment): State<DeploymentImpl>,
    Query(query): Query<CheckAgentAvailabilityQuery>,
) -> ResponseJson<ApiResponse<AvailabilityInfo>> {
    let profiles = ExecutorConfigs::get_cached();
    let profile_id = ExecutorProfileId::new(query.executor);

    let info = match profiles.get_coding_agent(&profile_id) {
        Some(agent) => agent.get_availability_info(),
        None => AvailabilityInfo::NotFound,
    };

    ResponseJson(ApiResponse::success(info))
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CliInstallMode {
    Npx,
    Binary,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CliStatusInfo {
    pub agent: BaseCodingAgent,
    pub binary_name: String,
    pub install_mode: CliInstallMode,
    pub installed: bool,
    pub binary_path: Option<String>,
    pub logged_in: bool,
    pub install_supported: bool,
    pub login_command: String,
}

#[derive(Debug, Deserialize, TS)]
pub struct CliAgentRequest {
    pub executor: BaseCodingAgent,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct CliActionResult {
    pub ok: bool,
    pub message: String,
}

struct CliSpec {
    agent: BaseCodingAgent,
    binary_name: &'static str,
    install_mode: CliInstallMode,
    install_unix: Option<&'static str>,
    install_win: Option<&'static str>,
    login_command: &'static str,
}

const CLI_SPECS: &[CliSpec] = &[
    CliSpec {
        agent: BaseCodingAgent::ClaudeCode,
        binary_name: "claude",
        install_mode: CliInstallMode::Npx,
        install_unix: None,
        install_win: None,
        login_command: "npx -y @anthropic-ai/claude-code@latest",
    },
    CliSpec {
        agent: BaseCodingAgent::Antigravity,
        binary_name: "agy",
        install_mode: CliInstallMode::Binary,
        install_unix: Some("curl -fsSL https://antigravity.google/cli/install.sh | bash"),
        install_win: Some("irm https://antigravity.google/cli/install.ps1 | iex"),
        login_command: "agy",
    },
    CliSpec {
        agent: BaseCodingAgent::Codex,
        binary_name: "codex",
        install_mode: CliInstallMode::Npx,
        install_unix: None,
        install_win: None,
        login_command: "npx -y @openai/codex@0.152.1 login",
    },
    CliSpec {
        agent: BaseCodingAgent::Gemini,
        binary_name: "gemini",
        install_mode: CliInstallMode::Npx,
        install_unix: None,
        install_win: None,
        login_command: "npx -y @google/gemini-cli@0.29.3",
    },
    CliSpec {
        agent: BaseCodingAgent::Opencode,
        binary_name: "opencode",
        install_mode: CliInstallMode::Binary,
        install_unix: Some("curl -fsSL https://opencode.ai/install | bash"),
        install_win: None,
        login_command: "opencode auth login",
    },
    CliSpec {
        agent: BaseCodingAgent::CursorAgent,
        binary_name: "cursor-agent",
        install_mode: CliInstallMode::Binary,
        install_unix: Some("curl -fsSL https://cursor.com/install | bash"),
        install_win: None,
        login_command: "cursor-agent login",
    },
    CliSpec {
        agent: BaseCodingAgent::Droid,
        binary_name: "droid",
        install_mode: CliInstallMode::Binary,
        install_unix: Some("curl -fsSL https://app.factory.ai/cli | sh"),
        install_win: None,
        login_command: "droid",
    },
    CliSpec {
        agent: BaseCodingAgent::QwenCode,
        binary_name: "qwen",
        install_mode: CliInstallMode::Npx,
        install_unix: None,
        install_win: None,
        login_command: "npx -y @qwen-code/qwen-code@0.9.1",
    },
    CliSpec {
        agent: BaseCodingAgent::Copilot,
        binary_name: "copilot",
        install_mode: CliInstallMode::Npx,
        install_unix: None,
        install_win: None,
        login_command: "npx -y @github/copilot@0.0.403",
    },
    CliSpec {
        agent: BaseCodingAgent::Amp,
        binary_name: "amp",
        install_mode: CliInstallMode::Npx,
        install_unix: None,
        install_win: None,
        login_command: "npx -y @sourcegraph/amp@latest login",
    },
];

fn canonical_cli_agent(agent: BaseCodingAgent) -> BaseCodingAgent {
    match agent {
        BaseCodingAgent::ClaudeCodeHeaded => BaseCodingAgent::ClaudeCode,
        BaseCodingAgent::OpencodeHeaded => BaseCodingAgent::Opencode,
        other => other,
    }
}

fn find_cli_binary(name: &str) -> Option<String> {
    let mut dirs: Vec<std::path::PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();

    if let Some(home) = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
    {
        for rel in [
            ".local/bin",
            ".opencode/bin",
            ".cursor/bin",
            ".droid/bin",
            "AppData/Local/agy/bin",
        ] {
            dirs.push(home.join(rel));
        }
    }
    #[cfg(not(windows))]
    {
        dirs.push(std::path::PathBuf::from("/opt/homebrew/bin"));
        dirs.push(std::path::PathBuf::from("/usr/local/bin"));
    }

    let candidates: Vec<String> = if cfg!(windows) {
        vec![format!("{name}.exe"), format!("{name}.cmd"), name.to_string()]
    } else {
        vec![name.to_string()]
    };

    for dir in dirs {
        for cand in &candidates {
            let full = dir.join(cand);
            if full.is_file() {
                return Some(full.to_string_lossy().into_owned());
            }
        }
    }
    None
}

async fn get_cli_statuses(
    State(_deployment): State<DeploymentImpl>,
) -> ResponseJson<ApiResponse<Vec<CliStatusInfo>>> {
    let profiles = ExecutorConfigs::get_cached();
    let npx_available = find_cli_binary("npx").is_some();

    let statuses = CLI_SPECS
        .iter()
        .map(|spec| {
            let profile_id = ExecutorProfileId::new(spec.agent);
            let availability = profiles
                .get_coding_agent(&profile_id)
                .map(|a| a.get_availability_info())
                .unwrap_or(AvailabilityInfo::NotFound);

            let (installed, binary_path) = match spec.install_mode {
                CliInstallMode::Npx => (npx_available, None),
                CliInstallMode::Binary => {
                    let path = find_cli_binary(spec.binary_name);
                    (path.is_some(), path)
                }
            };

            let logged_in = matches!(availability, AvailabilityInfo::LoginDetected { .. });
            let install_supported = if cfg!(windows) {
                spec.install_win.is_some()
            } else {
                spec.install_unix.is_some()
            };

            CliStatusInfo {
                agent: spec.agent,
                binary_name: spec.binary_name.to_string(),
                install_mode: spec.install_mode,
                installed,
                binary_path,
                logged_in,
                install_supported,
                login_command: spec.login_command.to_string(),
            }
        })
        .collect();

    ResponseJson(ApiResponse::success(statuses))
}

async fn install_cli(
    State(_deployment): State<DeploymentImpl>,
    Json(req): Json<CliAgentRequest>,
) -> ResponseJson<ApiResponse<CliActionResult>> {
    let canonical = canonical_cli_agent(req.executor);
    let Some(spec) = CLI_SPECS.iter().find(|s| s.agent == canonical) else {
        return ResponseJson(ApiResponse::success(CliActionResult {
            ok: false,
            message: format!("Unsupported CLI: {:?}", req.executor),
        }));
    };

    #[cfg(windows)]
    let output = {
        let Some(cmd) = spec.install_win else {
            return ResponseJson(ApiResponse::success(CliActionResult {
                ok: false,
                message: format!(
                    "Automatic install is not available on Windows for {}. Please install manually.",
                    spec.binary_name
                ),
            }));
        };
        tokio::process::Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd])
            .output()
            .await
    };

    #[cfg(not(windows))]
    let output = {
        let Some(cmd) = spec.install_unix else {
            return ResponseJson(ApiResponse::success(CliActionResult {
                ok: false,
                message: format!("{} is managed via npx and does not need installation.", spec.binary_name),
            }));
        };
        tokio::process::Command::new("bash")
            .args(["-lc", cmd])
            .output()
            .await
    };

    match output {
        Ok(out) if out.status.success() => ResponseJson(ApiResponse::success(CliActionResult {
            ok: true,
            message: format!("Installed {} successfully.", spec.binary_name),
        })),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let stdout = String::from_utf8_lossy(&out.stdout);
            let detail = if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else {
                stdout.trim().to_string()
            };
            ResponseJson(ApiResponse::success(CliActionResult {
                ok: false,
                message: if detail.is_empty() {
                    format!("Install exited with status {}", out.status)
                } else {
                    detail
                },
            }))
        }
        Err(err) => ResponseJson(ApiResponse::success(CliActionResult {
            ok: false,
            message: format!("Failed to run installer: {err}"),
        })),
    }
}

async fn login_cli(
    State(_deployment): State<DeploymentImpl>,
    Json(req): Json<CliAgentRequest>,
) -> ResponseJson<ApiResponse<CliActionResult>> {
    let canonical = canonical_cli_agent(req.executor);
    let Some(spec) = CLI_SPECS.iter().find(|s| s.agent == canonical) else {
        return ResponseJson(ApiResponse::success(CliActionResult {
            ok: false,
            message: format!("Unsupported CLI: {:?}", req.executor),
        }));
    };

    let full_cmd = if spec.install_mode == CliInstallMode::Binary {
        find_cli_binary(spec.binary_name)
            .map(|bin| spec.login_command.replacen(spec.binary_name, &bin, 1))
            .unwrap_or_else(|| spec.login_command.to_string())
    } else {
        spec.login_command.to_string()
    };

    #[cfg(target_os = "macos")]
    let spawn_res = {
        let escaped = full_cmd.replace('\\', "\\\\").replace('"', "\\\"");
        tokio::process::Command::new("osascript")
            .args([
                "-e",
                "tell application \"Terminal\" to activate",
                "-e",
                &format!("tell application \"Terminal\" to do script \"{escaped}\""),
            ])
            .spawn()
    };

    #[cfg(target_os = "windows")]
    let spawn_res = {
        tokio::process::Command::new("cmd")
            .args(["/c", "start", "", "cmd", "/k", &full_cmd])
            .spawn()
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let spawn_res = {
        tokio::process::Command::new("x-terminal-emulator")
            .args(["-e", "bash", "-lc", &format!("{full_cmd}; exec bash")])
            .spawn()
    };

    match spawn_res {
        Ok(_) => ResponseJson(ApiResponse::success(CliActionResult {
            ok: true,
            message: format!("Opened Terminal to run: {full_cmd}"),
        })),
        Err(err) => ResponseJson(ApiResponse::success(CliActionResult {
            ok: false,
            message: format!("Could not open Terminal automatically ({err}). Run manually: {full_cmd}"),
        })),
    }
}

#[derive(Debug, Deserialize, TS)]
pub struct AgentPresetOptionsQuery {
    pub executor: BaseCodingAgent,
    pub variant: Option<String>,
}

async fn get_agent_preset_options(
    Query(query): Query<AgentPresetOptionsQuery>,
) -> ResponseJson<ApiResponse<executors::profile::ExecutorConfig>> {
    let profiles = ExecutorConfigs::get_cached();
    let profile_id = if let Some(variant) = query.variant {
        ExecutorProfileId::with_variant(query.executor, variant)
    } else {
        ExecutorProfileId::new(query.executor)
    };

    let options = match profiles.get_coding_agent(&profile_id) {
        Some(agent) => agent.get_preset_options(),
        None => {
            // Return a default config if not found
            executors::profile::ExecutorConfig::new(query.executor)
        }
    };

    ResponseJson(ApiResponse::success(options))
}

#[derive(Debug, Deserialize)]
pub struct ExecutorDiscoveredOptionsStreamQuery {
    executor: BaseCodingAgent,
    #[serde(default)]
    session_id: Option<Uuid>,
    #[serde(default)]
    workspace_id: Option<Uuid>,
    #[serde(default)]
    repo_id: Option<Uuid>,
}

pub async fn stream_executor_discovered_options_ws(
    ws: SignedWsUpgrade,
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ExecutorDiscoveredOptionsStreamQuery>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = handle_executor_discovered_options_ws(socket, deployment, query).await {
            tracing::warn!("discovered options WS closed: {}", e);
        }
    })
}

async fn handle_executor_discovered_options_ws(
    mut socket: MaybeSignedWebSocket,
    deployment: DeploymentImpl,
    query: ExecutorDiscoveredOptionsStreamQuery,
) -> anyhow::Result<()> {
    use futures_util::StreamExt;

    match deployment
        .container()
        .discover_executor_options(
            ExecutorProfileId::new(query.executor),
            query.session_id,
            query.workspace_id,
            query.repo_id,
        )
        .await
    {
        Ok(Some(mut stream)) => {
            if let Some(patch) = stream.next().await {
                let _ = socket
                    .send(LogMsg::JsonPatch(patch).to_ws_message_unchecked())
                    .await;
            }

            let _ = socket.send(LogMsg::Ready.to_ws_message_unchecked()).await;

            loop {
                tokio::select! {
                    patch = stream.next() => {
                        let Some(patch) = patch else {
                            break;
                        };
                        if socket
                            .send(LogMsg::JsonPatch(patch).to_ws_message_unchecked())
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    inbound = socket.recv() => {
                        match inbound {
                            Ok(Some(Message::Close(_))) => break,
                            Ok(Some(_)) => {}
                            Ok(None) => break,
                            Err(_) => break,
                        }
                    }
                }
            }
        }
        Ok(None) => {
            let _ = socket.send(LogMsg::Ready.to_ws_message_unchecked()).await;
        }
        Err(e) => {
            tracing::warn!("Failed to start discovered options stream: {}", e);
        }
    }

    let _ = socket
        .send(LogMsg::Finished.to_ws_message_unchecked())
        .await;
    Ok(())
}
