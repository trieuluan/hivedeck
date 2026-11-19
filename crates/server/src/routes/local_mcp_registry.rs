use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

use axum::{Extension, Json, Router, routing::get};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RegistryTransport {
    Stdio,
    Http,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RegistryRole {
    Captain,
    Crew,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct RegistryEntry {
    pub name: String,
    pub transport: RegistryTransport,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub url: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub roles: Vec<RegistryRole>,
    #[serde(default)]
    pub boards: Vec<String>,
    #[serde(default)]
    pub oauth: bool,
}

#[derive(Deserialize, TS)]
pub struct SetRegistrySecret {
    pub value: String,
}

#[derive(Serialize, TS)]
pub struct RegistrySecretStatus {
    pub name: String,
    pub has_value: bool,
}

#[derive(Deserialize)]
struct ImportRequest {
    names: Vec<String>,
}

#[derive(Serialize)]
struct ImportCandidate {
    name: String,
    sources: Vec<&'static str>,
    exists: bool,
}

async fn merged_servers(home: &Path) -> BTreeMap<String, (serde_json::Value, Vec<&'static str>)> {
    let mut merged: BTreeMap<String, (serde_json::Value, Vec<&'static str>)> = BTreeMap::new();
    for source in ["claude_code", "codex"] {
        for (name, value) in source_servers(home, source).await.unwrap_or_default() {
            merged
                .entry(name)
                .and_modify(|(_, sources)| sources.push(source))
                .or_insert((value, vec![source]));
        }
    }
    merged
}

#[derive(Serialize)]
struct ImportResult {
    imported: Vec<String>,
    skipped: Vec<String>,
}

async fn source_servers(
    home: &Path,
    source: &str,
) -> Result<serde_json::Map<String, serde_json::Value>, ApiError> {
    let (path, key, toml) = match source {
        "claude_code" => (home.join(".claude.json"), "mcpServers", false),
        "codex" => (home.join(".codex/config.toml"), "mcp_servers", true),
        _ => return Err(ApiError::BadRequest("Invalid import source".into())),
    };
    let config = executors::mcp_config::McpConfig::new(
        vec![],
        serde_json::json!({}),
        serde_json::json!({}),
        toml,
    );
    let value = executors::mcp_config::read_agent_config(&path, &config).await?;
    Ok(value
        .get(key)
        .and_then(|servers| servers.as_object())
        .cloned()
        .unwrap_or_default())
}

fn home() -> Result<PathBuf, ApiError> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| ApiError::BadRequest("HOME not set".into()))
}

async fn candidates(
    Extension(dir): Extension<PathBuf>,
) -> Result<Json<ApiResponse<Vec<ImportCandidate>>>, ApiError> {
    let servers = merged_servers(&home()?).await;
    let entries: Vec<RegistryEntry> = read(&dir.join("mcp_registry.json"))?;
    let plugins = executors::plugins::read_plugins(&dir)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    Ok(Json(ApiResponse::success(
        servers
            .into_iter()
            .map(|(name, (_, sources))| ImportCandidate {
                exists: entries.iter().any(|entry| entry.name == name)
                    || plugins.iter().any(|plugin| {
                        plugin.name == name || plugin.mcp.iter().any(|entry| entry.name == name)
                    }),
                name,
                sources,
            })
            .collect(),
    )))
}

async fn import(
    Extension(dir): Extension<PathBuf>,
    Json(request): Json<ImportRequest>,
) -> Result<Json<ApiResponse<ImportResult>>, ApiError> {
    Ok(Json(ApiResponse::success(
        import_from(&dir, &home()?, request).await?,
    )))
}

async fn import_from(
    dir: &Path,
    home: &Path,
    request: ImportRequest,
) -> Result<ImportResult, ApiError> {
    let servers = merged_servers(home).await;
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Registry lock poisoned"))?;
    let registry_path = dir.join("mcp_registry.json");
    let mut entries: Vec<RegistryEntry> = read(&registry_path)?;
    let plugins = executors::plugins::read_plugins(dir)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    let mut secrets: BTreeMap<String, String> = BTreeMap::new();
    let mut result = ImportResult {
        imported: vec![],
        skipped: vec![],
    };
    for name in request.names {
        if name == "hivedeck"
            || entries.iter().any(|entry| entry.name == name)
            || plugins.iter().any(|plugin| {
                plugin.name == name || plugin.mcp.iter().any(|entry| entry.name == name)
            })
        {
            result.skipped.push(name);
            continue;
        }
        let (server, sources) = servers
            .get(&name)
            .ok_or_else(|| ApiError::BadRequest("Import server not found".into()))?;
        let server = server
            .as_object()
            .ok_or_else(|| ApiError::BadRequest("Invalid server".into()))?;
        let oauth = server
            .get("oauth")
            .map(|value| value.as_bool().unwrap_or(value.is_object()))
            .unwrap_or(false);
        let url = server
            .get("url")
            .and_then(|value| value.as_str())
            .map(str::to_owned);
        let mut entry = RegistryEntry {
            name: name.clone(),
            transport: if url.is_some() {
                RegistryTransport::Http
            } else {
                RegistryTransport::Stdio
            },
            command: server
                .get("command")
                .and_then(|value| value.as_str())
                .map(str::to_owned),
            args: serde_json::from_value(
                server
                    .get("args")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([])),
            )
            .map_err(|_| ApiError::BadRequest("Invalid server args".into()))?,
            url,
            headers: BTreeMap::new(),
            env: BTreeMap::new(),
            roles: vec![RegistryRole::Crew],
            boards: vec![],
            oauth,
        };
        for (field, target) in [
            ("env", &mut entry.env),
            (
                if sources[0] == "codex" {
                    "http_headers"
                } else {
                    "headers"
                },
                &mut entry.headers,
            ),
        ] {
            if let Some(values) = server.get(field) {
                let values = values
                    .as_object()
                    .ok_or_else(|| ApiError::BadRequest("Invalid server values".into()))?;
                for (key, value) in values {
                    if oauth && key.eq_ignore_ascii_case("authorization") {
                        continue;
                    }
                    let value = value
                        .as_str()
                        .ok_or_else(|| ApiError::BadRequest("Invalid server value".into()))?;
                    let value = if field != "env"
                        && key.eq_ignore_ascii_case("authorization")
                        && value
                            .get(..7)
                            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("bearer "))
                    {
                        &value[7..]
                    } else {
                        value
                    };
                    let reference = format!("import_{}", Uuid::new_v4().simple());
                    secrets.insert(reference.clone(), value.to_owned());
                    target.insert(key.clone(), reference);
                }
            }
        }
        if server.contains_key("bearer_token_env_var") {
            entry.headers.insert(
                "Authorization".into(),
                format!("import_{}", Uuid::new_v4().simple()),
            );
        }
        if let Some(headers) = server.get("env_http_headers") {
            let headers = headers
                .as_object()
                .ok_or_else(|| ApiError::BadRequest("Invalid server values".into()))?;
            for (name, value) in headers {
                if !value.is_string() {
                    return Err(ApiError::BadRequest("Invalid server value".into()));
                }
                entry
                    .headers
                    .insert(name.clone(), format!("import_{}", Uuid::new_v4().simple()));
            }
        }
        validate(&entry)?;
        let plugin_entry = serde_json::from_value(
            serde_json::to_value(&entry)
                .map_err(|error| ApiError::BadRequest(error.to_string()))?,
        )
        .map_err(|error| ApiError::BadRequest(format!("Invalid MCP: {error}")))?;
        let values = entry
            .headers
            .values()
            .chain(entry.env.values())
            .filter_map(|reference| {
                secrets
                    .remove(reference)
                    .map(|value| (reference.clone(), value))
            })
            .collect();
        executors::plugins::install_plugin(
            dir,
            executors::plugins::InstallPluginRequest {
                single_mcp: Some(plugin_entry),
                secrets: BTreeMap::from([(name.clone(), values)]),
                ..Default::default()
            },
        )
        .map_err(|error| ApiError::BadRequest(format!("Cannot import MCP {name}: {error}")))?;
        entries.push(entry);
        result.imported.push(name);
    }
    Ok(result)
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn validate(entry: &RegistryEntry) -> Result<(), ApiError> {
    if entry.name == "hivedeck"
        || !valid_name(&entry.name)
        || entry
            .headers
            .values()
            .chain(entry.env.values())
            .any(|name| !valid_name(name))
    {
        return Err(ApiError::BadRequest(
            "Invalid name or secret reference".into(),
        ));
    }
    let valid = match entry.transport {
        RegistryTransport::Stdio => {
            entry
                .command
                .as_ref()
                .is_some_and(|command| !command.trim().is_empty())
                && entry.url.is_none()
                && entry.headers.is_empty()
        }
        RegistryTransport::Http => {
            entry.command.is_none()
                && entry.args.is_empty()
                && entry.env.is_empty()
                && entry
                    .url
                    .as_ref()
                    .and_then(|url| url::Url::parse(url).ok())
                    .is_some_and(|url| {
                        matches!(url.scheme(), "http" | "https")
                            && url.host().is_some()
                            && url.username().is_empty()
                            && url.password().is_none()
                    })
        }
    };
    if !valid {
        return Err(ApiError::BadRequest("Invalid transport fields".into()));
    }
    Ok(())
}

fn read<T: DeserializeOwned + Default>(path: &Path) -> Result<T, ApiError> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid registry file").into()
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/mcp-registry/import-candidates", get(candidates))
        .route("/mcp-registry/import", axum::routing::post(import))
        .layer(Extension(utils::assets::asset_dir()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn merges_sources_preferring_claude_and_tolerates_missing_or_invalid_config() {
        let home = tempfile::tempdir().unwrap();
        let registry = tempfile::tempdir().unwrap();
        std::fs::create_dir(home.path().join(".codex")).unwrap();
        std::fs::write(
            home.path().join(".claude.json"),
            r#"{"mcpServers":{"shared":{"command":"claude"},"only_claude":{"command":"node"}}}"#,
        )
        .unwrap();
        let codex = home.path().join(".codex/config.toml");
        std::fs::write(
            &codex,
            "[mcp_servers.shared]\ncommand = 'codex'\n[mcp_servers.only_codex]\ncommand = 'node'\n",
        )
        .unwrap();
        let merged = merged_servers(home.path()).await;
        assert_eq!(merged.len(), 3);
        assert_eq!(merged["shared"].1, ["claude_code", "codex"]);
        import_from(
            registry.path(),
            home.path(),
            ImportRequest {
                names: vec!["shared".into()],
            },
        )
        .await
        .unwrap();
        let entries = executors::plugins::read_plugins(registry.path()).unwrap();
        assert_eq!(entries[0].mcp[0].command.as_deref(), Some("claude"));
        std::fs::remove_file(&codex).unwrap();
        assert_eq!(merged_servers(home.path()).await.len(), 2);
        std::fs::write(&codex, "invalid = [").unwrap();
        assert_eq!(merged_servers(home.path()).await.len(), 2);
    }

    #[tokio::test]
    async fn imports_codex_environment_headers_without_reading_secrets() {
        let home = tempfile::tempdir().unwrap();
        let registry = tempfile::tempdir().unwrap();
        std::fs::create_dir(home.path().join(".codex")).unwrap();
        std::fs::write(home.path().join(".codex/config.toml"), "[mcp_servers.bearer]\nurl = 'https://example.com'\nbearer_token_env_var = 'TOKEN'\n[mcp_servers.headers]\nurl = 'https://example.com'\n[mcp_servers.headers.env_http_headers]\nX-Api-Key = 'API_KEY'\n").unwrap();
        import_from(
            registry.path(),
            home.path(),
            ImportRequest {
                names: vec!["bearer".into(), "headers".into()],
            },
        )
        .await
        .unwrap();
        let entries = executors::plugins::read_plugins(registry.path()).unwrap();
        let secrets = executors::plugins::read_plugin_secrets(registry.path()).unwrap();
        assert!(
            !secrets["bearer"]["bearer"].contains_key(&entries[0].mcp[0].headers["Authorization"])
        );
        assert!(
            !secrets["headers"]["headers"].contains_key(&entries[1].mcp[0].headers["X-Api-Key"])
        );
    }

    #[tokio::test]
    async fn imports_without_changing_cli_configs() {
        let home = tempfile::tempdir().unwrap();
        let registry = tempfile::tempdir().unwrap();
        std::fs::create_dir(home.path().join(".codex")).unwrap();
        let claude = home.path().join(".claude.json");
        let codex = home.path().join(".codex/config.toml");
        std::fs::write(
            &claude,
            r#"{"mcpServers":{"local":{"command":"node","env":{"API_KEY":"secret"}}}}"#,
        )
        .unwrap();
        std::fs::write(&codex, "[mcp_servers.remote]\nurl = 'https://example.com/mcp'\n[mcp_servers.remote.http_headers]\nAuthorization = 'Bearer secret'\n").unwrap();
        for (source, path, name) in [
            ("claude_code", &claude, "local"),
            ("codex", &codex, "remote"),
        ] {
            let before = std::fs::read(path).unwrap();
            let modified = std::fs::metadata(path).unwrap().modified().unwrap();
            assert!(
                source_servers(home.path(), source)
                    .await
                    .unwrap()
                    .contains_key(name)
            );
            let request = || ImportRequest {
                names: vec![name.into()],
            };
            assert_eq!(
                import_from(registry.path(), home.path(), request())
                    .await
                    .unwrap()
                    .imported,
                vec![name]
            );
            assert_eq!(
                import_from(registry.path(), home.path(), request())
                    .await
                    .unwrap()
                    .skipped,
                vec![name]
            );
            assert_eq!(std::fs::read(path).unwrap(), before);
            assert_eq!(
                std::fs::metadata(path).unwrap().modified().unwrap(),
                modified
            );
        }
        let entries = executors::plugins::read_plugins(registry.path()).unwrap();
        let secrets = executors::plugins::read_plugin_secrets(registry.path()).unwrap();
        assert_eq!(
            secrets["local"]["local"][&entries[0].mcp[0].env["API_KEY"]],
            "secret"
        );
        assert_eq!(
            secrets["remote"]["remote"][&entries[1].mcp[0].headers["Authorization"]],
            "secret"
        );
        assert!(
            !std::fs::read_to_string(registry.path().join("plugins.json"))
                .unwrap()
                .contains("Bearer secret")
        );
    }
}
