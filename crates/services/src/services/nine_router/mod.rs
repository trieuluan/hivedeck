//! Managed 9router sidecar (see `docs/ADR/ADR-026-embedded-9router.md`).
//!
//! HiveDeck detects, installs, starts and stops a local
//! [9router](https://github.com/decolua/9router) instance. The router runs
//! detached in its own process group and outlives HiveDeck, because other
//! tools on the machine route through it too. Its PID and output live under
//! `<hivedeck home>/runtime/9router/`.
//!
//! A router that HiveDeck did not start (e.g. the user's own `9router --tray`)
//! is treated as *external*: HiveDeck reads its status but never starts a
//! second instance or stops it.
//!
//! Managed installs are versioned (see [`versions`]). Updates install the new
//! version side by side, boot it once on a scratch port with a scratch HOME
//! (smoke test), and only then switch to it; the old version is kept for
//! rollback.

mod advisor;
mod aliases;
pub mod api;
mod versions;

pub use advisor::{
    ComboRole, ComboSuggestions, ProviderHealth, ProviderHealthStatus, RoleSuggestion,
    SuggestedModel,
};

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use command_group::AsyncGroupChild;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use ts_rs::TS;
use utils::{command_ext::GroupSpawnNoWindowExt, shell::resolve_executable_path};

/// 9router version HiveDeck installs by default (tested against).
pub const PINNED_VERSION: &str = "0.5.116";
pub const DEFAULT_PORT: u16 = 20128;
const PACKAGE_NAME: &str = "9router";
const LAUNCHER_SOURCE: &str = include_str!("launch-9router.cjs");
const LOG_FILE: &str = "9router.log";
const PID_FILE: &str = "9router.pid";
const MAX_LOG_LINES: usize = 1000;
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);
const START_TIMEOUT: Duration = Duration::from_secs(45);

fn default_port() -> u16 {
    DEFAULT_PORT
}

/// User settings for the embedded router, stored in `Config.nine_router`.
#[derive(Clone, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct NineRouterSettings {
    /// Start 9router when HiveDeck boots (unless it is already running).
    #[serde(default)]
    pub auto_start: bool,
    /// Loopback port 9router listens on.
    #[serde(default = "default_port")]
    pub port: u16,
    /// User opted in to HiveDeck reading quotas and managing combos through
    /// 9router's local CLI token (ADR-027).
    #[serde(default)]
    pub allow_management: bool,
}

impl Default for NineRouterSettings {
    fn default() -> Self {
        Self {
            auto_start: false,
            port: DEFAULT_PORT,
            allow_management: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NineRouterInstallSource {
    /// Installed by HiveDeck under `<hivedeck home>/runtime/9router`.
    Managed,
    /// A global `9router` found on PATH.
    Global,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NineRouterState {
    NotInstalled,
    Installing,
    /// Installing and smoke-testing a newer version.
    Updating,
    Stopped,
    Starting,
    /// Running and started by HiveDeck.
    Running,
    /// Running, but not started by HiveDeck.
    External,
}

#[derive(Clone, Debug, Serialize, TS)]
pub struct NineRouterStatus {
    pub state: NineRouterState,
    pub port: u16,
    /// OpenAI/Anthropic-compatible base URL agents should use.
    pub base_url: String,
    /// Path of the dashboard on the router (relative to its origin).
    pub dashboard_path: String,
    pub install_source: Option<NineRouterInstallSource>,
    pub installed_version: Option<String>,
    pub pinned_version: String,
    /// Latest version on npm (cached; `None` if never fetched or offline).
    pub latest_version: Option<String>,
    /// `latest_version` is newer than `installed_version`.
    pub update_available: bool,
    /// HiveDeck can update this install itself (managed installs only).
    pub can_update: bool,
    /// Managed version kept for rollback.
    pub previous_version: Option<String>,
    /// Version of a global `9router` still installed while a managed copy is
    /// in use (`None` otherwise).
    pub global_version: Option<String>,
    pub package_dir: Option<String>,
    /// PID of the HiveDeck-started process, if any.
    pub pid: Option<u32>,
    pub node_available: bool,
    pub npm_available: bool,
    /// Combo names reported by `GET /v1/models` (`owned_by == "combo"`).
    pub combos: Vec<String>,
    pub model_count: usize,
    pub auto_start: bool,
    pub last_error: Option<String>,
    pub log_path: String,
}

#[derive(Clone, Debug, Serialize, TS)]
pub struct NineRouterLogs {
    pub lines: Vec<String>,
    pub log_path: String,
}

#[derive(Debug, thiserror::Error)]
pub enum NineRouterError {
    #[error("9router is not installed")]
    NotInstalled,
    #[error("Node.js was not found on PATH")]
    NodeNotFound,
    #[error("npm was not found on PATH")]
    NpmNotFound,
    #[error("an install or update is already in progress")]
    InstallInProgress,
    #[error("this 9router was not installed by HiveDeck; update it with `npm i -g 9router@latest`")]
    NotManaged,
    #[error("could not reach the npm registry to check for updates")]
    RegistryUnavailable,
    #[error("9router is already up to date (v{0})")]
    UpToDate(String),
    #[error("no previous version to roll back to")]
    NoPrevious,
    #[error("{0}")]
    UpdateFailed(String),
    #[error("allow HiveDeck to manage 9router first (Router page)")]
    ManagementDisabled,
    #[error("9router is not running on port {0}")]
    NotRunning(u16),
    #[error("invalid combo: {0}")]
    InvalidCombo(String),
    #[error(transparent)]
    Api(#[from] api::ApiError),
    #[error("9router is already running on port {0}")]
    AlreadyRunning(u16),
    #[error("9router on port {0} was not started by HiveDeck; stop it from where it was started")]
    External(u16),
    #[error("9router did not become ready within {0} seconds; check the logs")]
    StartTimeout(u64),
    #[error("9router exited during startup; check the logs")]
    ExitedEarly,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

#[derive(Default)]
struct Runtime {
    installing: bool,
    updating: bool,
    starting: bool,
    last_error: Option<String>,
}

static RUNTIME: LazyLock<Mutex<Runtime>> = LazyLock::new(|| Mutex::new(Runtime::default()));
/// Serialises start/stop/install so two clicks can't race.
static LIFECYCLE: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

fn with_runtime<T>(f: impl FnOnce(&mut Runtime) -> T) -> T {
    let mut guard = RUNTIME.lock().unwrap_or_else(|e| e.into_inner());
    f(&mut guard)
}

fn set_error(err: Option<String>) {
    with_runtime(|r| r.last_error = err);
}

/// `<hivedeck home>/runtime/9router`
pub fn runtime_dir() -> PathBuf {
    utils::path::get_hivedeck_home_dir()
        .join("runtime")
        .join(PACKAGE_NAME)
}

fn log_path() -> PathBuf {
    runtime_dir().join(LOG_FILE)
}

fn pid_path() -> PathBuf {
    runtime_dir().join(PID_FILE)
}

fn base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/v1")
}

/// Read `version` from a 9router package dir, verifying it really is 9router.
fn read_package_version(dir: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(dir.join("package.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    if json.get("name")?.as_str()? != PACKAGE_NAME {
        return None;
    }
    Some(json.get("version")?.as_str()?.to_string())
}

struct Install {
    source: NineRouterInstallSource,
    dir: PathBuf,
    version: String,
}

/// Find a usable 9router package: HiveDeck-managed first, then global.
async fn find_install() -> Option<Install> {
    if let Some(version) = versions::active() {
        return Some(Install {
            source: NineRouterInstallSource::Managed,
            dir: versions::version_package_dir(&version),
            version,
        });
    }
    find_global().await
}

/// A global `9router` on PATH, if any.
async fn find_global() -> Option<Install> {
    // The `9router` bin is a symlink to `<pkg>/cli.js`.
    let bin = resolve_executable_path(PACKAGE_NAME).await?;
    let real = std::fs::canonicalize(&bin).unwrap_or(bin);
    let mut candidates = Vec::new();
    if let Some(parent) = real.parent() {
        candidates.push(parent.to_path_buf());
        // Windows npm shim: `<prefix>/9router.cmd` → `<prefix>/node_modules/9router`.
        candidates.push(parent.join("node_modules").join(PACKAGE_NAME));
        // Unix prefix layout: `<prefix>/bin/9router` → `<prefix>/lib/node_modules/9router`.
        if let Some(prefix) = parent.parent() {
            candidates.push(prefix.join("lib").join("node_modules").join(PACKAGE_NAME));
        }
    }
    candidates.into_iter().find_map(|dir| {
        read_package_version(&dir).map(|version| Install {
            source: NineRouterInstallSource::Global,
            dir,
            version,
        })
    })
}

/// Recorded PID of a HiveDeck-started router, if that process is still alive.
fn managed_pid() -> Option<u32> {
    let pid: u32 = std::fs::read_to_string(pid_path())
        .ok()?
        .trim()
        .parse()
        .ok()?;
    if utils::process::is_pid_alive(pid) {
        Some(pid)
    } else {
        let _ = std::fs::remove_file(pid_path());
        None
    }
}

struct Probe {
    combos: Vec<String>,
    model_count: usize,
}

/// `GET /v1/models` — unauthenticated on 9router. `None` when nothing answers.
async fn probe(port: u16) -> Option<Probe> {
    #[derive(Deserialize)]
    struct Model {
        id: String,
        #[serde(default)]
        owned_by: Option<String>,
    }
    #[derive(Deserialize)]
    struct Models {
        data: Vec<Model>,
    }

    let client = reqwest::Client::builder()
        .timeout(PROBE_TIMEOUT)
        .build()
        .ok()?;
    let resp = client
        .get(format!("{}/models", base_url(port)))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let models: Models = resp.json().await.ok()?;
    let combos = models
        .data
        .iter()
        .filter(|m| m.owned_by.as_deref() == Some("combo"))
        .map(|m| m.id.clone())
        .collect();
    Some(Probe {
        combos,
        model_count: models.data.len(),
    })
}

/// Current status. `check_updates` queries npm now instead of using the
/// cached latest version.
pub async fn status(settings: &NineRouterSettings, check_updates: bool) -> NineRouterStatus {
    let port = settings.port;
    let install = find_install().await;
    let pid = managed_pid();
    let probe = probe(port).await;
    let latest = versions::latest(check_updates).await;
    let (installing, updating, starting, last_error) =
        with_runtime(|r| (r.installing, r.updating, r.starting, r.last_error.clone()));
    let managed = install
        .as_ref()
        .is_some_and(|i| i.source == NineRouterInstallSource::Managed);
    let update_available = match (&latest, &install) {
        (Some(latest), Some(install)) => versions::is_newer(latest, &install.version),
        _ => false,
    };

    let state = if updating {
        NineRouterState::Updating
    } else if installing {
        NineRouterState::Installing
    } else if starting {
        NineRouterState::Starting
    } else if probe.is_some() {
        if pid.is_some() {
            NineRouterState::Running
        } else {
            NineRouterState::External
        }
    } else if pid.is_some() {
        // Process alive but not answering yet (or wedged).
        NineRouterState::Starting
    } else if install.is_some() {
        NineRouterState::Stopped
    } else {
        NineRouterState::NotInstalled
    };

    NineRouterStatus {
        state,
        port,
        base_url: base_url(port),
        dashboard_path: "/dashboard".to_string(),
        install_source: install.as_ref().map(|i| i.source),
        installed_version: install.as_ref().map(|i| i.version.clone()),
        pinned_version: PINNED_VERSION.to_string(),
        latest_version: latest,
        update_available,
        can_update: managed,
        previous_version: if managed { versions::previous() } else { None },
        // A leftover global install next to a managed one can fight over the
        // port and the shared ~/.9router data; the UI suggests removing it.
        global_version: if managed {
            find_global().await.map(|g| g.version)
        } else {
            None
        },
        package_dir: install
            .as_ref()
            .map(|i| i.dir.to_string_lossy().to_string()),
        pid,
        node_available: resolve_executable_path("node").await.is_some(),
        npm_available: resolve_executable_path("npm").await.is_some(),
        combos: probe.as_ref().map(|p| p.combos.clone()).unwrap_or_default(),
        model_count: probe.as_ref().map(|p| p.model_count).unwrap_or(0),
        auto_start: settings.auto_start,
        last_error,
        log_path: log_path().to_string_lossy().to_string(),
    }
}

async fn open_log() -> std::io::Result<tokio::fs::File> {
    tokio::fs::create_dir_all(runtime_dir()).await?;
    tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())
        .await
}

async fn log_line(line: &str) {
    if let Ok(mut f) = open_log().await {
        let stamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S");
        let _ = f
            .write_all(format!("[hivedeck {stamp}] {line}\n").as_bytes())
            .await;
    }
}

/// Mark a background job (install/update) as running, or fail if one is.
fn begin_job(update: bool) -> Result<(), NineRouterError> {
    with_runtime(|r| {
        if r.installing || r.updating {
            return Err(NineRouterError::InstallInProgress);
        }
        if update {
            r.updating = true;
        } else {
            r.installing = true;
        }
        r.last_error = None;
        Ok(())
    })
}

fn end_job(result: Result<(), String>) {
    with_runtime(|r| {
        r.installing = false;
        r.updating = false;
        r.last_error = result.err();
    });
}

/// Install [`PINNED_VERSION`] as the managed version. Runs in the background;
/// progress goes to the log and `status().state == Installing`. Also used to
/// take over from a global install: if HiveDeck is running the router, it is
/// restarted on the managed copy.
pub async fn install(settings: &NineRouterSettings) -> Result<(), NineRouterError> {
    let npm = resolve_executable_path("npm")
        .await
        .ok_or(NineRouterError::NpmNotFound)?;
    begin_job(false)?;

    let settings = settings.clone();
    tokio::spawn(async move {
        let result = async {
            {
                let _lock = LIFECYCLE.lock().await;
                npm_install(&npm, PINNED_VERSION).await?;
                versions::activate(PINNED_VERSION).map_err(|e| e.to_string())?;
                versions::prune();
                log_line("install finished").await;
            }
            restart_if_managed(&settings)
                .await
                .map_err(|e| format!("installed but restart failed: {e}"))
        }
        .await;
        if let Err(e) = &result {
            tracing::warn!("9router install failed: {e}");
            log_line(&format!("install failed: {e}")).await;
        }
        end_job(result);
    });
    Ok(())
}

/// `npm install --prefix versions/<version> 9router@<version>`.
async fn npm_install(npm: &Path, version: &str) -> Result<(), String> {
    if versions::is_installed(version) {
        log_line(&format!("{PACKAGE_NAME}@{version} already present")).await;
        return Ok(());
    }
    let prefix = versions::version_prefix(version);
    tokio::fs::create_dir_all(&prefix)
        .await
        .map_err(|e| e.to_string())?;
    log_line(&format!(
        "installing {PACKAGE_NAME}@{version} into {}",
        prefix.display()
    ))
    .await;

    let log = open_log()
        .await
        .map_err(|e| e.to_string())?
        .into_std()
        .await;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;
    let status = tokio::process::Command::new(npm)
        .arg("install")
        .arg("--prefix")
        .arg(&prefix)
        .args(["--no-fund", "--no-audit", "--loglevel=error"])
        .arg(format!("{PACKAGE_NAME}@{version}"))
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .status()
        .await
        .map_err(|e| e.to_string())?;
    if !status.success() {
        versions::remove(version);
        return Err(format!("npm install exited with {status}"));
    }
    if !versions::is_installed(version) {
        versions::remove(version);
        return Err("npm install finished but the package is missing".to_string());
    }
    Ok(())
}

/// Update the managed install to the latest npm release. Runs in the
/// background (`status().state == Updating`):
/// install side by side → smoke test on a scratch port and scratch HOME →
/// switch → restart the router if HiveDeck is running it. A failed smoke test
/// leaves the current version untouched.
pub async fn update(settings: &NineRouterSettings) -> Result<(), NineRouterError> {
    let install = find_install().await.ok_or(NineRouterError::NotInstalled)?;
    if install.source != NineRouterInstallSource::Managed {
        return Err(NineRouterError::NotManaged);
    }
    let npm = resolve_executable_path("npm")
        .await
        .ok_or(NineRouterError::NpmNotFound)?;
    let node = resolve_executable_path("node")
        .await
        .ok_or(NineRouterError::NodeNotFound)?;
    let latest = versions::latest(true)
        .await
        .ok_or(NineRouterError::RegistryUnavailable)?;
    if !versions::is_newer(&latest, &install.version) {
        return Err(NineRouterError::UpToDate(install.version));
    }
    begin_job(true)?;

    let settings = settings.clone();
    tokio::spawn(async move {
        let result = run_update(&npm, &node, &install.version, &latest, &settings).await;
        if let Err(e) = &result {
            tracing::warn!("9router update failed: {e}");
            log_line(&format!("update failed: {e}")).await;
        }
        end_job(result);
    });
    Ok(())
}

async fn run_update(
    npm: &Path,
    node: &Path,
    current: &str,
    target: &str,
    settings: &NineRouterSettings,
) -> Result<(), String> {
    {
        let _lock = LIFECYCLE.lock().await;
        log_line(&format!("updating 9router {current} -> {target}")).await;
        npm_install(npm, target).await?;
        if let Err(e) = smoke_test(node, &versions::version_package_dir(target)).await {
            versions::remove(target);
            return Err(format!(
                "v{target} failed to start in a test run ({e}); staying on v{current}"
            ));
        }
        versions::activate(target).map_err(|e| e.to_string())?;
        versions::prune();
    }
    log_line(&format!("now using 9router {target}")).await;
    restart_if_managed(settings)
        .await
        .map_err(|e| format!("switched to v{target} but restart failed: {e}"))
}

/// Switch back to the previous managed version and restart if running.
pub async fn rollback(settings: &NineRouterSettings) -> Result<(), NineRouterError> {
    {
        let _lock = LIFECYCLE.lock().await;
        if with_runtime(|r| r.installing || r.updating) {
            return Err(NineRouterError::InstallInProgress);
        }
        let version = versions::swap_to_previous().ok_or(NineRouterError::NoPrevious)?;
        log_line(&format!("rolled back to 9router {version}")).await;
    }
    set_error(None);
    restart_if_managed(settings).await
}

async fn restart_if_managed(settings: &NineRouterSettings) -> Result<(), NineRouterError> {
    if managed_pid().is_some() {
        restart(settings).await
    } else {
        Ok(())
    }
}

/// Boot a version once on a free port with a scratch HOME (so it never
/// touches `~/.9router`), wait for `/v1/models`, then kill it.
async fn smoke_test(node: &Path, package_dir: &Path) -> Result<(), NineRouterError> {
    let port = free_port()?;
    let home = runtime_dir().join("smoke-home");
    tokio::fs::create_dir_all(&home).await?;
    log_line(&format!("smoke test on 127.0.0.1:{port}")).await;
    let env = [
        ("HOME", home.clone().into_os_string()),
        ("USERPROFILE", home.clone().into_os_string()),
        ("APPDATA", home.into_os_string()),
    ];
    let mut child = spawn_router(node, package_dir, port, &env).await?;
    let pid = child.id();
    let ready = wait_ready(&mut child, port).await;
    if let Some(pid) = pid {
        let _ = utils::process::terminate_process_group_by_pid(pid).await;
    }
    let _ = child.wait().await;
    ready
}

fn free_port() -> std::io::Result<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

/// Start 9router on the configured port and wait until it answers.
pub async fn start(settings: &NineRouterSettings) -> Result<(), NineRouterError> {
    let _lock = LIFECYCLE.lock().await;
    let port = settings.port;
    if probe(port).await.is_some() {
        return Err(if managed_pid().is_some() {
            NineRouterError::AlreadyRunning(port)
        } else {
            NineRouterError::External(port)
        });
    }
    let install = find_install().await.ok_or(NineRouterError::NotInstalled)?;
    let node = resolve_executable_path("node")
        .await
        .ok_or(NineRouterError::NodeNotFound)?;

    with_runtime(|r| {
        r.starting = true;
        r.last_error = None;
    });
    let result = spawn_and_wait(&node, &install, port).await;
    with_runtime(|r| {
        r.starting = false;
        r.last_error = result.as_ref().err().map(|e| e.to_string());
    });
    result
}

/// Spawn the launcher for `package_dir` on `port`, output appended to the log.
async fn spawn_router(
    node: &Path,
    package_dir: &Path,
    port: u16,
    extra_env: &[(&str, OsString)],
) -> Result<AsyncGroupChild, NineRouterError> {
    let dir = runtime_dir();
    tokio::fs::create_dir_all(&dir).await?;
    let launcher = dir.join("launch-9router.cjs");
    tokio::fs::write(&launcher, LAUNCHER_SOURCE).await?;

    let log = open_log().await?.into_std().await;
    let log_err = log.try_clone()?;
    let mut cmd = tokio::process::Command::new(node);
    cmd.arg(&launcher)
        .arg(package_dir)
        .current_dir(&dir)
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    for (key, value) in extra_env {
        cmd.env(key, value);
    }
    Ok(cmd.group_spawn_no_window()?)
}

/// Wait until the router answers on `port`, or fail if it exits / times out.
async fn wait_ready(child: &mut AsyncGroupChild, port: u16) -> Result<(), NineRouterError> {
    let deadline = tokio::time::Instant::now() + START_TIMEOUT;
    loop {
        if probe(port).await.is_some() {
            return Ok(());
        }
        if let Ok(Some(_)) = child.try_wait() {
            return Err(NineRouterError::ExitedEarly);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(NineRouterError::StartTimeout(START_TIMEOUT.as_secs()));
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

async fn spawn_and_wait(node: &Path, install: &Install, port: u16) -> Result<(), NineRouterError> {
    log_line(&format!(
        "starting 9router {} ({:?}) on 127.0.0.1:{port}",
        install.version, install.source
    ))
    .await;
    let mut child = spawn_router(node, &install.dir, port, &[]).await?;
    let pid = child
        .id()
        .ok_or_else(|| std::io::Error::other("spawned 9router has no PID"))?;
    tokio::fs::write(pid_path(), pid.to_string()).await?;

    if let Err(e) = wait_ready(&mut child, port).await {
        let _ = utils::process::terminate_process_group_by_pid(pid).await;
        let _ = tokio::fs::remove_file(pid_path()).await;
        return Err(e);
    }

    // Reap the child when it exits so it doesn't linger as a zombie while
    // HiveDeck runs. If HiveDeck exits first, the router keeps running.
    tokio::spawn(async move {
        let status = child.wait().await;
        tracing::info!("9router (pid {pid}) exited: {status:?}");
        log_line(&format!("9router exited: {status:?}")).await;
        if std::fs::read_to_string(pid_path())
            .map(|s| s.trim() == pid.to_string())
            .unwrap_or(false)
        {
            let _ = std::fs::remove_file(pid_path());
        }
    });
    log_line("9router is ready").await;
    Ok(())
}

/// Stop a HiveDeck-started router. Refuses to touch an external one.
pub async fn stop(settings: &NineRouterSettings) -> Result<(), NineRouterError> {
    let _lock = LIFECYCLE.lock().await;
    let Some(pid) = managed_pid() else {
        if probe(settings.port).await.is_some() {
            return Err(NineRouterError::External(settings.port));
        }
        return Ok(());
    };
    log_line(&format!("stopping 9router (pid {pid})")).await;
    utils::process::terminate_process_group_by_pid(pid).await?;
    let _ = tokio::fs::remove_file(pid_path()).await;
    set_error(None);
    Ok(())
}

pub async fn restart(settings: &NineRouterSettings) -> Result<(), NineRouterError> {
    stop(settings).await?;
    start(settings).await
}

/// Last `limit` lines of the router log.
pub async fn logs(limit: usize) -> NineRouterLogs {
    let path = log_path();
    let raw = tokio::fs::read_to_string(&path).await.unwrap_or_default();
    let limit = limit.clamp(1, MAX_LOG_LINES);
    let lines: Vec<&str> = raw.lines().collect();
    let start = lines.len().saturating_sub(limit);
    NineRouterLogs {
        lines: lines[start..].iter().map(|s| s.to_string()).collect(),
        log_path: path.to_string_lossy().to_string(),
    }
}

/// Full `/v1/models` listing with capabilities.
async fn fetch_models(port: u16) -> Option<Vec<advisor::ModelInfo>> {
    #[derive(Deserialize, Default)]
    #[serde(rename_all = "camelCase")]
    struct Caps {
        #[serde(default)]
        tools: bool,
        #[serde(default)]
        reasoning: bool,
        context_window: Option<u64>,
    }
    #[derive(Deserialize)]
    struct Model {
        id: String,
        #[serde(default)]
        owned_by: String,
        #[serde(default)]
        capabilities: Option<Caps>,
        context_length: Option<u64>,
    }
    #[derive(Deserialize)]
    struct Models {
        data: Vec<Model>,
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?;
    let models: Models = client
        .get(format!("{}/models", base_url(port)))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .await
        .ok()?;
    Some(
        models
            .data
            .into_iter()
            .map(|m| {
                let caps = m.capabilities.unwrap_or_default();
                advisor::ModelInfo {
                    id: m.id,
                    owned_by: m.owned_by,
                    tools: caps.tools,
                    reasoning: caps.reasoning,
                    context_window: caps.context_window.or(m.context_length),
                }
            })
            .collect(),
    )
}

fn management_client(settings: &NineRouterSettings) -> Result<api::Client, NineRouterError> {
    if !settings.allow_management {
        return Err(NineRouterError::ManagementDisabled);
    }
    Ok(api::Client::new(settings.port)?)
}

/// Suggest a combo per agent role from the models, provider health and quota
/// 9router reports right now.
pub async fn suggestions(
    settings: &NineRouterSettings,
) -> Result<ComboSuggestions, NineRouterError> {
    let client = management_client(settings)?;
    let models = fetch_models(settings.port)
        .await
        .ok_or(NineRouterError::NotRunning(settings.port))?;
    let connections = client.connections().await?;
    let existing = client.combos().await?;

    // Usage per active, error-free connection, in parallel.
    let usages = futures::future::join_all(connections.iter().map(|c| {
        let client = &client;
        async move {
            if c.is_active && c.error.is_none() {
                client.usage(&c.id).await.ok()
            } else {
                None
            }
        }
    }))
    .await;
    let entries: Vec<_> = connections.into_iter().zip(usages).collect();
    let mut health = advisor::provider_health(&entries);

    // Fill alias and model counts; list providers that have models but no
    // connection record (e.g. local/no-auth providers) as unknown.
    for m in models.iter().filter(|m| m.owned_by != "combo") {
        let provider = advisor::provider_for_alias(&m.owned_by);
        let h = health
            .entry(provider.clone())
            .or_insert_with(|| ProviderHealth {
                provider: provider.clone(),
                alias: String::new(),
                status: ProviderHealthStatus::Unknown,
                remaining_percent: None,
                quota_name: None,
                reset_at: None,
                message: None,
                summary: None,
                model_count: 0,
            });
        h.alias = m.owned_by.clone();
        h.model_count += 1;
    }

    let mut roles = advisor::suggest(&models, &health, &existing);
    let history = read_combo_history().await;
    for r in &mut roles {
        r.undo_available = history.contains_key(&r.combo_name);
    }
    let mut providers: Vec<ProviderHealth> = health.into_values().collect();
    providers.sort_by(|a, b| a.provider.cmp(&b.provider));
    Ok(ComboSuggestions {
        roles,
        providers,
        generated_at: chrono::Utc::now().to_rfc3339(),
    })
}

fn valid_combo_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Create the combo `name`, or replace its models if it already exists.
/// Every model must be one 9router currently lists.
pub async fn apply_combo(
    settings: &NineRouterSettings,
    name: &str,
    models: &[String],
) -> Result<(), NineRouterError> {
    if !valid_combo_name(name) {
        return Err(NineRouterError::InvalidCombo(
            "name may only contain letters, digits, - and _".into(),
        ));
    }
    if models.is_empty() {
        return Err(NineRouterError::InvalidCombo(
            "pick at least one model".into(),
        ));
    }
    let client = management_client(settings)?;
    let available = fetch_models(settings.port)
        .await
        .ok_or(NineRouterError::NotRunning(settings.port))?;
    if let Some(unknown) = models.iter().find(|id| {
        !available
            .iter()
            .any(|m| &m.id == *id && m.owned_by != "combo")
    }) {
        return Err(NineRouterError::InvalidCombo(format!(
            "unknown model {unknown}"
        )));
    }
    let existing = client.combos().await?.into_iter().find(|c| c.name == name);
    // Remember what we replace so the user can undo it.
    let mut history = read_combo_history().await;
    history.insert(
        name.to_string(),
        ComboBackup {
            previous: existing.as_ref().map(|c| c.models.clone()),
            replaced_at: chrono::Utc::now().to_rfc3339(),
        },
    );
    write_combo_history(&history).await?;
    match existing {
        Some(existing) => client.update_combo(&existing.id, models).await?,
        None => client.create_combo(name, models).await?,
    }
    log_line(&format!("combo {name} set to [{}]", models.join(", "))).await;
    Ok(())
}

/// What a HiveDeck write replaced: the old model list, or `None` when the
/// combo did not exist before (undo deletes it).
#[derive(Clone, Debug, Serialize, Deserialize)]
struct ComboBackup {
    previous: Option<Vec<String>>,
    replaced_at: String,
}

fn combo_history_path() -> PathBuf {
    runtime_dir().join("combo-history.json")
}

async fn read_combo_history() -> std::collections::HashMap<String, ComboBackup> {
    tokio::fs::read_to_string(combo_history_path())
        .await
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

async fn write_combo_history(
    history: &std::collections::HashMap<String, ComboBackup>,
) -> std::io::Result<()> {
    tokio::fs::create_dir_all(runtime_dir()).await?;
    let raw = serde_json::to_string_pretty(history).map_err(std::io::Error::other)?;
    tokio::fs::write(combo_history_path(), raw).await
}

/// Restore the combo HiveDeck last replaced (or delete it if HiveDeck
/// created it). One level of undo per combo.
pub async fn undo_combo(settings: &NineRouterSettings, name: &str) -> Result<(), NineRouterError> {
    let client = management_client(settings)?;
    let mut history = read_combo_history().await;
    let backup = history
        .remove(name)
        .ok_or_else(|| NineRouterError::InvalidCombo(format!("nothing to undo for {name}")))?;
    let current = client.combos().await?.into_iter().find(|c| c.name == name);
    match (backup.previous, current) {
        (Some(models), Some(current)) => client.update_combo(&current.id, &models).await?,
        (Some(models), None) => client.create_combo(name, &models).await?,
        (None, Some(current)) => client.delete_combo(&current.id).await?,
        (None, None) => {}
    }
    write_combo_history(&history).await?;
    log_line(&format!("combo {name} restored")).await;
    Ok(())
}

/// Boot hook: start the router in the background when `auto_start` is on and
/// nothing is listening yet. Never blocks server startup.
pub fn spawn_autostart(settings: NineRouterSettings) {
    if !settings.auto_start {
        return;
    }
    tokio::spawn(async move {
        if probe(settings.port).await.is_some() {
            tracing::info!("9router already running on port {}", settings.port);
            return;
        }
        match start(&settings).await {
            Ok(()) => tracing::info!("9router auto-started on port {}", settings.port),
            Err(e) => tracing::warn!("9router auto-start failed: {e}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_default_uses_standard_port() {
        let s: NineRouterSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s, NineRouterSettings::default());
        assert_eq!(s.port, DEFAULT_PORT);
        assert!(!s.auto_start);
    }

    #[test]
    fn package_version_requires_matching_name() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("package.json"),
            r#"{"name":"9router","version":"1.2.3"}"#,
        )
        .unwrap();
        assert_eq!(read_package_version(dir.path()).as_deref(), Some("1.2.3"));

        std::fs::write(
            dir.path().join("package.json"),
            r#"{"name":"something-else","version":"1.2.3"}"#,
        )
        .unwrap();
        assert_eq!(read_package_version(dir.path()), None);
    }

    #[test]
    fn validates_combo_names() {
        assert!(valid_combo_name("coder"));
        assert!(valid_combo_name("fast_2-b"));
        assert!(!valid_combo_name(""));
        assert!(!valid_combo_name("bad name"));
        assert!(!valid_combo_name("../x"));
    }

    #[test]
    fn launcher_is_embedded() {
        assert!(LAUNCHER_SOURCE.contains("custom-server.js"));
        assert!(LAUNCHER_SOURCE.contains("server.js"));
    }

    /// End-to-end lifecycle against a real 9router install found on PATH.
    /// Uses a throwaway HOME so it never touches `~/.9router` or a running
    /// router. Run with:
    /// `cargo test -p services --lib nine_router::tests::lifecycle -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "needs a global 9router install and network-free npm runtime"]
    async fn lifecycle_with_isolated_home() {
        let home = tempfile::tempdir().unwrap();
        // SAFETY: test-only, runs alone (ignored by default).
        unsafe { std::env::set_var("HOME", home.path()) };
        let settings = NineRouterSettings {
            port: 20199,
            ..Default::default()
        };

        let before = status(&settings, false).await;
        assert_eq!(before.state, NineRouterState::Stopped, "{before:?}");

        start(&settings).await.expect("start");
        let up = status(&settings, false).await;
        assert_eq!(up.state, NineRouterState::Running, "{up:?}");
        assert!(up.pid.is_some());
        assert!(matches!(
            start(&settings).await,
            Err(NineRouterError::AlreadyRunning(20199))
        ));

        stop(&settings).await.expect("stop");
        let down = status(&settings, false).await;
        assert_eq!(down.state, NineRouterState::Stopped, "{down:?}");
        assert!(
            logs(50)
                .await
                .lines
                .iter()
                .any(|l| l.contains("9router is ready"))
        );
    }

    /// Install → start → update to npm latest (with smoke test) → rollback →
    /// stop, all under a throwaway HOME. Downloads from npm. Run with:
    /// `cargo test -p services --lib nine_router::tests::update -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "downloads 9router from npm"]
    async fn update_and_rollback_with_isolated_home() {
        let home = tempfile::tempdir().unwrap();
        // SAFETY: test-only, runs alone (ignored by default).
        unsafe { std::env::set_var("HOME", home.path()) };
        let settings = NineRouterSettings {
            port: 20198,
            ..Default::default()
        };
        let wait_idle = || async {
            for _ in 0..600 {
                if !with_runtime(|r| r.installing || r.updating) {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            panic!("job did not finish");
        };

        install(&settings).await.expect("install");
        wait_idle().await;
        let installed = status(&settings, true).await;
        assert_eq!(
            installed.install_source,
            Some(NineRouterInstallSource::Managed)
        );
        assert_eq!(installed.installed_version.as_deref(), Some(PINNED_VERSION));
        // The machine's global 9router (used by the lifecycle test) is still
        // on PATH, so it must be reported as a leftover.
        assert!(installed.global_version.is_some(), "{installed:?}");
        let latest = installed.latest_version.clone().expect("npm latest");

        start(&settings).await.expect("start");
        if !installed.update_available {
            eprintln!("pinned {PINNED_VERSION} is already latest ({latest}); skipping update");
            stop(&settings).await.unwrap();
            return;
        }

        update(&settings).await.expect("update");
        wait_idle().await;
        let updated = status(&settings, false).await;
        assert_eq!(updated.last_error, None, "{updated:?}");
        assert_eq!(updated.installed_version.as_deref(), Some(latest.as_str()));
        assert_eq!(updated.previous_version.as_deref(), Some(PINNED_VERSION));
        assert_eq!(updated.state, NineRouterState::Running, "{updated:?}");

        rollback(&settings).await.expect("rollback");
        let rolled = status(&settings, false).await;
        assert_eq!(rolled.installed_version.as_deref(), Some(PINNED_VERSION));
        assert_eq!(rolled.previous_version.as_deref(), Some(latest.as_str()));
        assert_eq!(rolled.state, NineRouterState::Running, "{rolled:?}");

        stop(&settings).await.expect("stop");
    }
}
