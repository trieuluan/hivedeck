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

use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use ts_rs::TS;
use utils::{command_ext::GroupSpawnNoWindowExt, shell::resolve_executable_path};

/// 9router version HiveDeck installs and has been tested against.
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
}

impl Default for NineRouterSettings {
    fn default() -> Self {
        Self {
            auto_start: false,
            port: DEFAULT_PORT,
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
    #[error("an install is already in progress")]
    InstallInProgress,
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

fn managed_package_dir() -> PathBuf {
    runtime_dir().join("node_modules").join(PACKAGE_NAME)
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
    let managed = managed_package_dir();
    if let Some(version) = read_package_version(&managed) {
        return Some(Install {
            source: NineRouterInstallSource::Managed,
            dir: managed,
            version,
        });
    }

    // Global: the `9router` bin is a symlink to `<pkg>/cli.js`.
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

pub async fn status(settings: &NineRouterSettings) -> NineRouterStatus {
    let port = settings.port;
    let install = find_install().await;
    let pid = managed_pid();
    let probe = probe(port).await;
    let (installing, starting, last_error) =
        with_runtime(|r| (r.installing, r.starting, r.last_error.clone()));

    let state = if installing {
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

/// Install the pinned version under the runtime dir. Runs in the background;
/// progress goes to the log and `status().state == Installing`.
pub async fn install() -> Result<(), NineRouterError> {
    let npm = resolve_executable_path("npm")
        .await
        .ok_or(NineRouterError::NpmNotFound)?;
    if with_runtime(|r| std::mem::replace(&mut r.installing, true)) {
        return Err(NineRouterError::InstallInProgress);
    }
    set_error(None);

    tokio::spawn(async move {
        let _lock = LIFECYCLE.lock().await;
        let result = run_npm_install(&npm).await;
        if let Err(e) = &result {
            tracing::warn!("9router install failed: {e}");
            log_line(&format!("install failed: {e}")).await;
        }
        with_runtime(|r| {
            r.installing = false;
            r.last_error = result.err();
        });
    });
    Ok(())
}

async fn run_npm_install(npm: &Path) -> Result<(), String> {
    let dir = runtime_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    log_line(&format!(
        "installing {PACKAGE_NAME}@{PINNED_VERSION} into {}",
        dir.display()
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
        .arg(&dir)
        .args(["--no-fund", "--no-audit", "--loglevel=error"])
        .arg(format!("{PACKAGE_NAME}@{PINNED_VERSION}"))
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .status()
        .await
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("npm install exited with {status}"));
    }
    if read_package_version(&managed_package_dir()).is_none() {
        return Err("npm install finished but the package is missing".to_string());
    }
    log_line("install finished").await;
    Ok(())
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

async fn spawn_and_wait(node: &Path, install: &Install, port: u16) -> Result<(), NineRouterError> {
    let dir = runtime_dir();
    tokio::fs::create_dir_all(&dir).await?;
    let launcher = dir.join("launch-9router.cjs");
    tokio::fs::write(&launcher, LAUNCHER_SOURCE).await?;

    log_line(&format!(
        "starting 9router {} ({:?}) on 127.0.0.1:{port}",
        install.version, install.source
    ))
    .await;
    let log = open_log().await?.into_std().await;
    let log_err = log.try_clone()?;

    let mut cmd = tokio::process::Command::new(node);
    cmd.arg(&launcher)
        .arg(&install.dir)
        .current_dir(&dir)
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    let mut child = cmd.group_spawn_no_window()?;
    let pid = child
        .id()
        .ok_or_else(|| std::io::Error::other("spawned 9router has no PID"))?;
    tokio::fs::write(pid_path(), pid.to_string()).await?;

    let deadline = tokio::time::Instant::now() + START_TIMEOUT;
    loop {
        if probe(port).await.is_some() {
            break;
        }
        if let Ok(Some(_)) = child.try_wait() {
            let _ = tokio::fs::remove_file(pid_path()).await;
            return Err(NineRouterError::ExitedEarly);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(NineRouterError::StartTimeout(START_TIMEOUT.as_secs()));
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
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
            auto_start: false,
            port: 20199,
        };

        let before = status(&settings).await;
        assert_eq!(before.state, NineRouterState::Stopped, "{before:?}");

        start(&settings).await.expect("start");
        let up = status(&settings).await;
        assert_eq!(up.state, NineRouterState::Running, "{up:?}");
        assert!(up.pid.is_some());
        assert!(matches!(
            start(&settings).await,
            Err(NineRouterError::AlreadyRunning(20199))
        ));

        stop(&settings).await.expect("stop");
        let down = status(&settings).await;
        assert_eq!(down.state, NineRouterState::Stopped, "{down:?}");
        assert!(
            logs(50)
                .await
                .lines
                .iter()
                .any(|l| l.contains("9router is ready"))
        );
    }
}
