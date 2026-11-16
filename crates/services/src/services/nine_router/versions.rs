//! Versioned layout for HiveDeck-managed 9router installs, plus the npm
//! registry check for new releases.
//!
//! ```text
//! <hivedeck home>/runtime/9router/
//!   versions/<version>/node_modules/9router   one dir per installed version
//!   active                                    version string in use
//!   previous                                  version to roll back to
//! ```

use std::{
    cmp::Ordering,
    path::PathBuf,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use serde::Deserialize;

use super::{PACKAGE_NAME, read_package_version, runtime_dir};

const ACTIVE_FILE: &str = "active";
const PREVIOUS_FILE: &str = "previous";
const REGISTRY_URL: &str = "https://registry.npmjs.org/9router/latest";
const REGISTRY_TIMEOUT: Duration = Duration::from_secs(6);
const LATEST_TTL: Duration = Duration::from_secs(6 * 60 * 60);

fn versions_dir() -> PathBuf {
    runtime_dir().join("versions")
}

/// Install prefix for one version (`npm install --prefix <this>`).
pub(super) fn version_prefix(version: &str) -> PathBuf {
    versions_dir().join(version)
}

/// Package dir for one version.
pub(super) fn version_package_dir(version: &str) -> PathBuf {
    version_prefix(version)
        .join("node_modules")
        .join(PACKAGE_NAME)
}

/// Whether `version` is fully installed (package.json readable and matching).
pub(super) fn is_installed(version: &str) -> bool {
    read_package_version(&version_package_dir(version)).as_deref() == Some(version)
}

fn read_marker(name: &str) -> Option<String> {
    let raw = std::fs::read_to_string(runtime_dir().join(name)).ok()?;
    let v = raw.trim();
    (!v.is_empty() && is_valid_version(v)).then(|| v.to_string())
}

fn write_marker(name: &str, value: Option<&str>) -> std::io::Result<()> {
    let path = runtime_dir().join(name);
    match value {
        Some(v) => {
            std::fs::create_dir_all(runtime_dir())?;
            std::fs::write(path, v)
        }
        None => match std::fs::remove_file(path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        },
    }
}

/// Version currently in use, if it is installed.
pub(super) fn active() -> Option<String> {
    read_marker(ACTIVE_FILE).filter(|v| is_installed(v))
}

/// Version to roll back to, if it is still installed.
pub(super) fn previous() -> Option<String> {
    read_marker(PREVIOUS_FILE).filter(|v| is_installed(v))
}

/// Make `version` active, remembering the old active one as `previous`.
pub(super) fn activate(version: &str) -> std::io::Result<()> {
    let old = active();
    write_marker(ACTIVE_FILE, Some(version))?;
    match old.as_deref() {
        Some(old) if old != version => write_marker(PREVIOUS_FILE, Some(old)),
        _ => Ok(()),
    }
}

/// Swap active and previous. Returns the version now active.
pub(super) fn swap_to_previous() -> Option<String> {
    let prev = previous()?;
    let cur = active();
    write_marker(ACTIVE_FILE, Some(&prev)).ok()?;
    write_marker(PREVIOUS_FILE, cur.as_deref()).ok()?;
    Some(prev)
}

/// Delete installed versions other than active and previous.
pub(super) fn prune() {
    let keep: Vec<String> = [active(), previous()].into_iter().flatten().collect();
    let Ok(entries) = std::fs::read_dir(versions_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !keep.contains(&name) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Remove one version dir (used when an update fails its smoke test).
pub(super) fn remove(version: &str) {
    let _ = std::fs::remove_dir_all(version_prefix(version));
}

/// `x.y.z` with optional `-pre`/`+build`; digits only in the core.
pub(super) fn is_valid_version(v: &str) -> bool {
    parse(v).is_some() && !v.contains(['/', '\\']) && !v.contains("..")
}

fn parse(v: &str) -> Option<(u64, u64, u64, bool)> {
    let v = v.trim().trim_start_matches('v');
    let (core, pre) = match v.split_once(['-', '+']) {
        Some((core, rest)) => (core, !rest.is_empty() && v.contains('-')),
        None => (v, false),
    };
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch, pre))
}

/// Semver-ish comparison; a pre-release sorts before its release.
pub(super) fn compare(a: &str, b: &str) -> Option<Ordering> {
    let (a1, a2, a3, a_pre) = parse(a)?;
    let (b1, b2, b3, b_pre) = parse(b)?;
    Some(
        (a1, a2, a3)
            .cmp(&(b1, b2, b3))
            .then_with(|| b_pre.cmp(&a_pre)),
    )
}

pub(super) fn is_newer(candidate: &str, current: &str) -> bool {
    compare(candidate, current) == Some(Ordering::Greater)
}

struct LatestCache {
    fetched_at: Instant,
    version: Option<String>,
}

static LATEST: LazyLock<Mutex<Option<LatestCache>>> = LazyLock::new(|| Mutex::new(None));
static REFRESHING: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));

async fn fetch_latest() -> Option<String> {
    #[derive(Deserialize)]
    struct Latest {
        version: String,
    }
    let client = reqwest::Client::builder()
        .timeout(REGISTRY_TIMEOUT)
        .build()
        .ok()?;
    let latest: Latest = client
        .get(REGISTRY_URL)
        .header("accept", "application/json")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .await
        .ok()?;
    is_valid_version(&latest.version).then_some(latest.version)
}

fn store(version: Option<String>) {
    let mut cache = LATEST.lock().unwrap_or_else(|e| e.into_inner());
    // Keep the last good value when a refresh fails (e.g. offline).
    let version = version.or_else(|| cache.as_ref().and_then(|c| c.version.clone()));
    *cache = Some(LatestCache {
        fetched_at: Instant::now(),
        version,
    });
}

/// Latest published version. With `force`, queries npm now; otherwise
/// returns the cached value and refreshes it in the background when stale,
/// so status polling never waits on the network.
pub(super) async fn latest(force: bool) -> Option<String> {
    if force {
        let v = fetch_latest().await;
        store(v);
    } else {
        let stale = LATEST
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .is_none_or(|c| c.fetched_at.elapsed() > LATEST_TTL);
        let mut refreshing = REFRESHING.lock().unwrap_or_else(|e| e.into_inner());
        if stale && !*refreshing {
            *refreshing = true;
            tokio::spawn(async {
                let v = fetch_latest().await;
                store(v);
                *REFRESHING.lock().unwrap_or_else(|e| e.into_inner()) = false;
            });
        }
    }
    LATEST
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .and_then(|c| c.version.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(is_newer("0.5.119", "0.5.116"));
        assert!(is_newer("0.6.0", "0.5.999"));
        assert!(is_newer("1.0.0", "1.0.0-beta.1"));
        assert!(!is_newer("0.5.116", "0.5.116"));
        assert!(!is_newer("0.5.2", "0.5.10"));
        assert_eq!(compare("junk", "1.0.0"), None);
    }

    #[test]
    fn rejects_path_like_versions() {
        assert!(is_valid_version("0.5.116"));
        assert!(!is_valid_version("../0.5.116"));
        assert!(!is_valid_version("0.5"));
        assert!(!is_valid_version("latest"));
    }
}
