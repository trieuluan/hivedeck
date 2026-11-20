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

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ImportKind {
    #[default]
    Mcp,
    Skill,
}

#[derive(Deserialize)]
struct ImportSelection {
    name: String,
    #[serde(default)]
    kind: ImportKind,
}

#[derive(Deserialize)]
struct ImportRequest {
    #[serde(default)]
    names: Vec<String>,
    #[serde(default)]
    items: Vec<ImportSelection>,
}

#[derive(Serialize)]
struct ImportCandidate {
    name: String,
    kind: ImportKind,
    sources: Vec<&'static str>,
    exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}

const CLI_MCP_SOURCES: &[&str] = &[
    "claude_code",
    "codex",
    "opencode",
    "gemini",
    "cursor_agent",
    "copilot",
    "qwen_code",
    "amp",
    "droid",
];

const CLI_SKILL_DIRS: &[(&str, &[&str])] = &[
    ("claude_code", &[".claude/skills"]),
    ("codex", &[".codex/skills", ".agents/skills"]),
    ("opencode", &[".config/opencode/skills"]),
    ("gemini", &[".gemini/skills"]),
    ("cursor_agent", &[".cursor/skills"]),
    ("copilot", &[".copilot/skills"]),
    ("qwen_code", &[".qwen/skills"]),
    ("amp", &[".config/agents/skills", ".config/amp/skills"]),
    ("droid", &[".factory/skills"]),
];

struct ScannedSkill {
    path: PathBuf,
    description: Option<String>,
    sources: Vec<&'static str>,
}

async fn merged_servers(home: &Path) -> BTreeMap<String, (serde_json::Value, Vec<&'static str>)> {
    let mut merged: BTreeMap<String, (serde_json::Value, Vec<&'static str>)> = BTreeMap::new();
    for source in CLI_MCP_SOURCES {
        for (name, value) in source_servers(home, source).await.unwrap_or_default() {
            merged
                .entry(name)
                .and_modify(|(_, sources)| {
                    if !sources.contains(source) {
                        sources.push(source);
                    }
                })
                .or_insert((value, vec![source]));
        }
    }
    merged
}

fn scanned_skills(home: &Path) -> BTreeMap<String, ScannedSkill> {
    let mut merged: BTreeMap<String, ScannedSkill> = BTreeMap::new();
    for (source, rel_dirs) in CLI_SKILL_DIRS {
        for rel in *rel_dirs {
            let dir = home.join(rel);
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if !valid_name(name) {
                    continue;
                }
                let skill_md = path.join("SKILL.md");
                if !skill_md.is_file() {
                    continue;
                }
                let description = std::fs::read_to_string(&skill_md)
                    .ok()
                    .and_then(|content| executors::plugins::extract_skill_description(&content));
                merged
                    .entry(name.to_owned())
                    .and_modify(|existing| {
                        if !existing.sources.contains(source) {
                            existing.sources.push(source);
                        }
                        if existing.description.is_none() {
                            existing.description = description.clone();
                        }
                    })
                    .or_insert_with(|| ScannedSkill {
                        path,
                        description,
                        sources: vec![source],
                    });
            }
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
        "opencode" => (home.join(".config/opencode/opencode.json"), "mcp", false),
        "gemini" => (home.join(".gemini/settings.json"), "mcpServers", false),
        "cursor_agent" => (home.join(".cursor/mcp.json"), "mcpServers", false),
        "copilot" => (home.join(".copilot/mcp-config.json"), "mcpServers", false),
        "qwen_code" => (home.join(".qwen/settings.json"), "mcpServers", false),
        "amp" => (
            home.join(".config/amp/settings.json"),
            "amp.mcpServers",
            false,
        ),
        "droid" => (home.join(".factory/mcp.json"), "mcpServers", false),
        _ => return Err(ApiError::BadRequest("Invalid import source".into())),
    };
    let config = executors::mcp_config::McpConfig::new(
        vec![],
        serde_json::json!({}),
        serde_json::json!({}),
        toml,
    );
    let value = executors::mcp_config::read_agent_config(&path, &config).await?;
    let raw_map = if source == "amp" {
        value
            .get("amp.mcpServers")
            .or_else(|| value.get("amp").and_then(|v| v.get("mcpServers")))
            .and_then(|servers| servers.as_object())
            .cloned()
            .unwrap_or_default()
    } else {
        value
            .get(key)
            .and_then(|servers| servers.as_object())
            .cloned()
            .unwrap_or_default()
    };
    if source == "opencode" {
        Ok(raw_map
            .into_iter()
            .map(|(name, v)| (name, normalize_opencode_server(v)))
            .collect())
    } else {
        Ok(raw_map)
    }
}

fn normalize_opencode_server(value: serde_json::Value) -> serde_json::Value {
    let Some(mut obj) = value.as_object().cloned() else {
        return value;
    };
    if let Some(cmd_arr) = obj.get("command").and_then(|v| v.as_array()).cloned() {
        let mut parts = cmd_arr.iter().filter_map(|v| v.as_str().map(str::to_owned));
        if let Some(cmd) = parts.next() {
            obj.insert("command".into(), serde_json::Value::String(cmd));
            let args: Vec<serde_json::Value> = parts.map(serde_json::Value::String).collect();
            obj.insert("args".into(), serde_json::Value::Array(args));
        }
    }
    if obj.get("env").is_none()
        && let Some(env_obj) = obj.remove("environment")
    {
        obj.insert("env".into(), env_obj);
    }
    serde_json::Value::Object(obj)
}

fn home() -> Result<PathBuf, ApiError> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| ApiError::BadRequest("HOME not set".into()))
}

async fn candidates(
    Extension(dir): Extension<PathBuf>,
) -> Result<Json<ApiResponse<Vec<ImportCandidate>>>, ApiError> {
    let user_home = home()?;
    let servers = merged_servers(&user_home).await;
    let skills = scanned_skills(&user_home);
    let entries: Vec<RegistryEntry> = read(&dir.join("mcp_registry.json"))?;
    let plugins = executors::plugins::read_plugins(&dir)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;

    let mut out: Vec<ImportCandidate> = servers
        .into_iter()
        .map(|(name, (_, sources))| ImportCandidate {
            exists: entries.iter().any(|entry| entry.name == name)
                || plugins.iter().any(|plugin| {
                    plugin.name == name || plugin.mcp.iter().any(|entry| entry.name == name)
                }),
            name,
            kind: ImportKind::Mcp,
            sources,
            description: None,
        })
        .collect();

    for (name, skill) in skills {
        let exists = plugins.iter().any(|plugin| {
            plugin.name == name || plugin.skills.iter().any(|entry| entry.name == name)
        });
        out.push(ImportCandidate {
            name,
            kind: ImportKind::Skill,
            sources: skill.sources,
            exists,
            description: skill.description,
        });
    }

    Ok(Json(ApiResponse::success(out)))
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();
        if name_str == ".git" || name_str == "node_modules" || name_str == "target" {
            continue;
        }
        let src_path = entry.path();
        let dst_path = dst.join(&file_name);
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if src_path.is_file() {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

struct TempDirGuard(PathBuf);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn import_standalone_skill(dir: &Path, name: &str, skill_dir: &Path) -> Result<(), ApiError> {
    let staging_root =
        std::env::temp_dir().join(format!("hivedeck-skill-import-{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&staging_root)
        .map_err(|err| ApiError::BadRequest(format!("Cannot create staging dir: {err}")))?;
    let _guard = TempDirGuard(staging_root.clone());
    let staged_skill_dir = staging_root.join("skills").join(name);
    copy_dir_recursive(skill_dir, &staged_skill_dir)
        .map_err(|err| ApiError::BadRequest(format!("Cannot stage skill {name}: {err}")))?;
    let manifest = serde_json::json!({
        "name": name,
        "version": "local",
        "skills": "skills"
    });
    std::fs::write(
        staging_root.join("plugin.json"),
        serde_json::to_vec_pretty(&manifest)
            .map_err(|err| ApiError::BadRequest(err.to_string()))?,
    )
    .map_err(|err| ApiError::BadRequest(format!("Cannot write skill manifest: {err}")))?;

    executors::plugins::install_plugin(
        dir,
        executors::plugins::InstallPluginRequest {
            source: staging_root.to_string_lossy().into_owned(),
            ..Default::default()
        },
    )
    .map_err(|error| ApiError::BadRequest(format!("Cannot import skill {name}: {error}")))?;
    Ok(())
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
    let skills = scanned_skills(home);
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Registry lock poisoned"))?;
    let registry_path = dir.join("mcp_registry.json");
    let mut entries: Vec<RegistryEntry> = read(&registry_path)?;
    let mut plugins = executors::plugins::read_plugins(dir)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    let mut secrets: BTreeMap<String, String> = BTreeMap::new();
    let mut result = ImportResult {
        imported: vec![],
        skipped: vec![],
    };
    let selections: Vec<ImportSelection> = if !request.items.is_empty() {
        request.items
    } else {
        request
            .names
            .into_iter()
            .map(|name| ImportSelection {
                name,
                kind: ImportKind::Mcp,
            })
            .collect()
    };
    for selection in selections {
        let name = selection.name;
        if selection.kind == ImportKind::Skill {
            if name == "hivedeck"
                || plugins.iter().any(|plugin| {
                    plugin.name == name || plugin.skills.iter().any(|entry| entry.name == name)
                })
            {
                result.skipped.push(name);
                continue;
            }
            let skill = skills
                .get(&name)
                .ok_or_else(|| ApiError::BadRequest("Import skill not found".into()))?;
            import_standalone_skill(dir, &name, &skill.path)?;
            plugins = executors::plugins::read_plugins(dir)
                .map_err(|error| ApiError::BadRequest(error.to_string()))?;
            result.imported.push(name);
            continue;
        }
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
                items: vec![],
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
                items: vec![],
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
                items: vec![],
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

    #[tokio::test]
    async fn scans_multiple_clis_and_imports_deduplicated_skills_and_opencode_mcp() {
        let home = tempfile::tempdir().unwrap();
        let registry = tempfile::tempdir().unwrap();

        std::fs::create_dir_all(home.path().join(".config/opencode")).unwrap();
        std::fs::write(
            home.path().join(".config/opencode/opencode.json"),
            r#"{"mcp":{"oc_tool":{"type":"local","command":["npx","-y","@example/mcp"],"environment":{"TOKEN":"abc"}}}}"#,
        )
        .unwrap();

        std::fs::create_dir_all(home.path().join(".claude/skills/code-review")).unwrap();
        std::fs::write(
            home.path().join(".claude/skills/code-review/SKILL.md"),
            "---\ndescription: Review diffs carefully\n---\n# Code Review\n",
        )
        .unwrap();

        std::fs::create_dir_all(home.path().join(".codex/skills/code-review")).unwrap();
        std::fs::write(
            home.path().join(".codex/skills/code-review/SKILL.md"),
            "---\ndescription: Duplicate skill\n---\n# Code Review\n",
        )
        .unwrap();

        let servers = merged_servers(home.path()).await;
        assert!(servers.contains_key("oc_tool"));
        assert_eq!(servers["oc_tool"].1, ["opencode"]);

        let skills = scanned_skills(home.path());
        assert_eq!(skills.len(), 1);
        assert_eq!(skills["code-review"].sources, ["claude_code", "codex"]);
        assert_eq!(
            skills["code-review"].description.as_deref(),
            Some("Review diffs carefully")
        );

        let result = import_from(
            registry.path(),
            home.path(),
            ImportRequest {
                names: vec![],
                items: vec![
                    ImportSelection {
                        name: "oc_tool".into(),
                        kind: ImportKind::Mcp,
                    },
                    ImportSelection {
                        name: "code-review".into(),
                        kind: ImportKind::Skill,
                    },
                ],
            },
        )
        .await
        .unwrap();
        assert_eq!(result.imported, vec!["oc_tool", "code-review"]);

        let plugins = executors::plugins::read_plugins(registry.path()).unwrap();
        assert_eq!(plugins.len(), 2);
        assert_eq!(plugins[0].mcp[0].command.as_deref(), Some("npx"));
        assert_eq!(plugins[0].mcp[0].args, vec!["-y", "@example/mcp"]);
        assert_eq!(plugins[1].name, "code-review");
        assert_eq!(plugins[1].skills.len(), 1);
        assert_eq!(plugins[1].skills[0].name, "code-review");
    }
}
