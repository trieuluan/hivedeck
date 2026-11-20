use std::collections::{BTreeMap, HashMap};

use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Clone, Deserialize)]
pub struct RegistryEntry {
    pub name: String,
    pub transport: String,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub url: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub roles: Vec<String>,
    #[serde(default)]
    pub boards: Vec<String>,
}

#[derive(Clone)]
pub struct InjectedMcpServer {
    pub name: String,
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    pub headers: BTreeMap<String, String>,
    pub env: BTreeMap<String, String>,
}

pub fn select(
    entries: Vec<RegistryEntry>,
    secrets: &BTreeMap<String, String>,
    _cli: &str,
    role: &str,
    board: Option<&str>,
) -> Result<(Vec<InjectedMcpServer>, HashMap<String, String>), String> {
    let mut servers = Vec::new();
    let mut variables = HashMap::new();
    let mut references = HashMap::new();
    for entry in entries {
        if entry.name == "hivedeck"
            || !entry.roles.iter().any(|item| item == role)
            || (!entry.boards.is_empty()
                && !board.is_some_and(|board| entry.boards.iter().any(|item| item == board)))
        {
            continue;
        }
        let mut resolve = |values: BTreeMap<String, String>| -> Result<_, String> {
            values
                .into_iter()
                .map(|(key, name)| {
                    if name.is_empty()
                        || !name.bytes().all(|byte| {
                            byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
                        })
                    {
                        return Err("Invalid MCP secret reference".into());
                    }
                    let variable = format!(
                        "HIVEDECK_MCP_{}_TOKEN",
                        name.replace('-', "_").to_ascii_uppercase()
                    );
                    if references
                        .insert(variable.clone(), name.clone())
                        .is_some_and(|previous| previous != name)
                    {
                        return Err("Conflicting MCP secret variable names".into());
                    }
                    let secret = secrets
                        .get(&name)
                        .ok_or_else(|| format!("Missing MCP secret: {name}"))?;
                    variables.insert(variable.clone(), secret.clone());
                    Ok((key, variable))
                })
                .collect()
        };
        let headers = resolve(entry.headers)?;
        let env = resolve(entry.env)?;
        servers.push(InjectedMcpServer {
            name: entry.name,
            transport: entry.transport,
            command: entry.command,
            args: entry.args,
            url: entry.url,
            headers,
            env,
        });
    }
    Ok((servers, variables))
}

pub fn claude_config(servers: &[InjectedMcpServer], existing: Option<&str>) -> String {
    let mut config: Value = existing
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or_else(|| json!({"mcpServers": {}}));
    if !config.get("mcpServers").is_some_and(Value::is_object) {
        config["mcpServers"] = json!({});
    }
    let map = config["mcpServers"].as_object_mut().unwrap();
    for server in servers {
        let definition = if server.transport == "http" {
            let headers: BTreeMap<_, _> = server
                .headers
                .iter()
                .map(|(key, variable)| {
                    (
                        key,
                        if key.eq_ignore_ascii_case("authorization") {
                            format!("Bearer ${{{variable}}}")
                        } else {
                            format!("${{{variable}}}")
                        },
                    )
                })
                .collect();
            json!({"type": "http", "url": server.url, "headers": headers})
        } else {
            let env: BTreeMap<_, _> = server
                .env
                .iter()
                .map(|(key, variable)| (key, format!("${{{variable}}}")))
                .collect();
            json!({"type": "stdio", "command": server.command, "args": server.args, "env": env})
        };
        map.insert(server.name.clone(), definition);
    }
    config.to_string()
}

pub fn opencode_config(servers: &[InjectedMcpServer], existing: Option<&str>) -> String {
    let mut config: Value = existing
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or_else(|| json!({}));
    if !config.get("mcp").is_some_and(Value::is_object) {
        config["mcp"] = json!({});
    }
    let map = config["mcp"].as_object_mut().unwrap();
    for server in servers {
        let definition = if server.transport == "http" {
            let headers: BTreeMap<_, _> = server
                .headers
                .iter()
                .map(|(key, variable)| {
                    (
                        key,
                        if key.eq_ignore_ascii_case("authorization") {
                            format!("Bearer {{env:{variable}}}")
                        } else {
                            format!("{{env:{variable}}}")
                        },
                    )
                })
                .collect();
            json!({"type": "remote", "url": server.url, "headers": headers, "enabled": true})
        } else {
            let env: BTreeMap<_, _> = server
                .env
                .iter()
                .map(|(key, variable)| (key, format!("{{env:{variable}}}")))
                .collect();
            let command: Vec<_> = server.command.iter().chain(server.args.iter()).collect();
            json!({"type": "local", "command": command, "environment": env, "enabled": true})
        };
        map.insert(server.name.clone(), definition);
    }
    config.to_string()
}

/// Per-run settings for Gemini CLI (`GEMINI_CLI_SYSTEM_SETTINGS_PATH`) and
/// Qwen Code (`QWEN_CODE_SYSTEM_SETTINGS_PATH`). Both expand `$VAR` /
/// `${VAR}` from the process env when loading settings, so the file holds
/// placeholders only. `mcpServers` is shallow-merged, so user servers stay.
pub fn gemini_family_settings(
    servers: &[InjectedMcpServer],
    existing: Option<&str>,
    qwen: bool,
) -> String {
    let mut config: Value = existing
        .and_then(|value| serde_json::from_str(value).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));
    if qwen && config.get("$version").is_none() {
        config["$version"] = json!(2);
    }
    if !config.get("mcpServers").is_some_and(Value::is_object) {
        config["mcpServers"] = json!({});
    }
    let map = config["mcpServers"].as_object_mut().unwrap();
    for server in servers {
        let definition = if server.transport == "http" {
            let headers: BTreeMap<_, _> = server
                .headers
                .iter()
                .map(|(key, variable)| {
                    (
                        key,
                        if key.eq_ignore_ascii_case("authorization") {
                            format!("Bearer ${{{variable}}}")
                        } else {
                            format!("${{{variable}}}")
                        },
                    )
                })
                .collect();
            if qwen {
                // Qwen 0.9.1: `url` is SSE, `httpUrl` is streamable HTTP.
                json!({"httpUrl": server.url, "headers": headers})
            } else {
                json!({"url": server.url, "type": "http", "headers": headers})
            }
        } else {
            let env: BTreeMap<_, _> = server
                .env
                .iter()
                .map(|(key, variable)| (key, format!("${{{variable}}}")))
                .collect();
            json!({"command": server.command, "args": server.args, "env": env})
        };
        map.insert(server.name.clone(), definition);
    }
    config.to_string()
}

fn placeholder_headers(server: &InjectedMcpServer) -> BTreeMap<&str, String> {
    server
        .headers
        .iter()
        .map(|(key, variable)| {
            (
                key.as_str(),
                if key.eq_ignore_ascii_case("authorization") {
                    format!("Bearer ${{{variable}}}")
                } else {
                    format!("${{{variable}}}")
                },
            )
        })
        .collect()
}

fn placeholder_env(server: &InjectedMcpServer) -> BTreeMap<&str, String> {
    server
        .env
        .iter()
        .map(|(key, variable)| (key.as_str(), format!("${{{variable}}}")))
        .collect()
}

/// Amp `--mcp-config <json>`: expects a bare `{serverName: definition}` map
/// (wrapping in `mcpServers` or `amp.mcpServers` is rejected). Expands `${VAR}`
/// in stdio `env` and HTTP `headers` from the process env.
pub fn amp_config(servers: &[InjectedMcpServer]) -> String {
    let mut map = serde_json::Map::new();
    for server in servers {
        let definition = if server.transport == "http" {
            json!({"url": server.url, "headers": placeholder_headers(server)})
        } else {
            json!({"command": server.command, "args": server.args, "env": placeholder_env(server)})
        };
        map.insert(server.name.clone(), definition);
    }
    Value::Object(map).to_string()
}

/// Copilot `--additional-mcp-config <json>`: expects `{"mcpServers": {...}}`
/// and requires `tools` (e.g. `["*"]`) on every server definition. Expands
/// `${VAR}` from the process env in `env` and `headers`.
pub fn copilot_config(servers: &[InjectedMcpServer]) -> String {
    let mut map = serde_json::Map::new();
    for server in servers {
        let definition = if server.transport == "http" {
            json!({
                "type": "http",
                "url": server.url,
                "headers": placeholder_headers(server),
                "tools": ["*"],
            })
        } else {
            json!({
                "type": "stdio",
                "command": server.command,
                "args": server.args,
                "env": placeholder_env(server),
                "tools": ["*"],
            })
        };
        map.insert(server.name.clone(), definition);
    }
    json!({"mcpServers": map}).to_string()
}

/// Cursor Agent `--plugin-dir <dir>` `.mcp.json`: expects `{"mcpServers": {...}}`
/// and expands `${VAR}` from `process.env`.
pub fn cursor_mcp_config(servers: &[InjectedMcpServer]) -> String {
    let mut map = serde_json::Map::new();
    for server in servers {
        let definition = if server.transport == "http" {
            json!({"url": server.url, "headers": placeholder_headers(server)})
        } else {
            json!({"command": server.command, "args": server.args, "env": placeholder_env(server)})
        };
        map.insert(server.name.clone(), definition);
    }
    json!({"mcpServers": map}).to_string()
}

/// Droid `--settings <path>` runtime overlay: expects `{"mcp": {"mcpServers": {...}}}`
/// and expands `${VAR}` from `process.env` in stdio `env` and HTTP `headers`.
pub fn droid_settings(servers: &[InjectedMcpServer], existing: Option<&str>) -> String {
    let mut config: Value = existing
        .and_then(|value| serde_json::from_str(value).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));
    if !config.get("mcp").is_some_and(Value::is_object) {
        config["mcp"] = json!({});
    }
    if !config["mcp"]
        .get("mcpServers")
        .is_some_and(Value::is_object)
    {
        config["mcp"]["mcpServers"] = json!({});
    }
    let map = config["mcp"]["mcpServers"].as_object_mut().unwrap();
    for server in servers {
        let definition = if server.transport == "http" {
            json!({"type": "http", "url": server.url, "headers": placeholder_headers(server)})
        } else {
            json!({"type": "stdio", "command": server.command, "args": server.args, "env": placeholder_env(server)})
        };
        map.insert(server.name.clone(), definition);
    }
    config.to_string()
}

fn valid_env_ident(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == b'_')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn codex_server_key(name: &str) -> String {
    if !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        name.to_string()
    } else {
        toml::Value::String(name.to_string()).to_string()
    }
}

pub fn codex_args(servers: &[InjectedMcpServer]) -> Vec<String> {
    let mut args = Vec::new();
    for server in servers {
        let prefix = format!("mcp_servers.{}", codex_server_key(&server.name));
        let mut fields = toml::map::Map::new();
        let mut push = |field: &str, value: toml::Value| {
            fields.insert(field.to_string(), value);
        };
        push("enabled", toml::Value::Boolean(true));
        if server.transport == "http" {
            if let Some(url) = &server.url {
                push("url", toml::Value::String(url.clone()));
            }
            let mut headers = toml::map::Map::new();
            for (key, variable) in &server.headers {
                if key.eq_ignore_ascii_case("authorization") {
                    push(
                        "bearer_token_env_var",
                        toml::Value::String(variable.clone()),
                    );
                } else {
                    headers.insert(key.clone(), toml::Value::String(variable.clone()));
                }
            }
            if !headers.is_empty() {
                push("env_http_headers", toml::Value::Table(headers));
            }
        } else if cfg!(unix)
            && !server.env.is_empty()
            && server.command.is_some()
            && server
                .env
                .iter()
                .all(|(key, var)| valid_env_ident(key) && valid_env_ident(var))
        {
            let command = server.command.as_ref().unwrap();
            let mut script = String::new();
            let mut forwarded = std::collections::BTreeSet::new();
            for (key, var) in &server.env {
                script.push_str(&format!("export {key}=\"${var}\"; "));
                forwarded.insert(var.clone());
            }
            for var in &forwarded {
                if !server.env.contains_key(var) {
                    script.push_str(&format!("unset {var}; "));
                }
            }
            script.push_str("exec \"$0\" \"$@\"");
            let mut wrapped_args = vec![
                toml::Value::String("-c".into()),
                toml::Value::String(script),
                toml::Value::String(command.clone()),
            ];
            wrapped_args.extend(server.args.iter().cloned().map(toml::Value::String));
            push("command", toml::Value::String("/bin/sh".into()));
            push("args", toml::Value::Array(wrapped_args));
            push(
                "env_vars",
                toml::Value::Array(forwarded.into_iter().map(toml::Value::String).collect()),
            );
        } else {
            if let Some(command) = &server.command {
                push("command", toml::Value::String(command.clone()));
            }
            push(
                "args",
                toml::Value::Array(
                    server
                        .args
                        .iter()
                        .cloned()
                        .map(toml::Value::String)
                        .collect(),
                ),
            );
            if !server.env.is_empty() {
                push(
                    "env_vars",
                    toml::Value::Array(
                        server
                            .env
                            .keys()
                            .cloned()
                            .map(toml::Value::String)
                            .collect(),
                    ),
                );
            }
        }
        args.extend([
            "-c".to_string(),
            format!("{prefix}={}", toml::Value::Table(fields)),
        ]);
    }
    args
}

pub fn codex_disable_args(names: &[String]) -> Vec<String> {
    names
        .iter()
        .flat_map(|name| {
            [
                "-c".to_string(),
                format!("mcp_servers.{}.enabled=false", codex_server_key(name)),
            ]
        })
        .collect()
}

pub fn filter_codex_conflicts(
    servers: &mut Vec<InjectedMcpServer>,
    config_paths: &[std::path::PathBuf],
    args: &[String],
) -> Vec<String> {
    if servers.is_empty() {
        return Vec::new();
    }
    let mut configs = Vec::new();
    let mut unknown = false;
    for path in config_paths {
        match std::fs::read_to_string(path) {
            Ok(content) => match content.parse::<toml::Value>() {
                Ok(config) => configs.push(config),
                Err(_) => unknown = true,
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => unknown = true,
        }
    }
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        let override_value = if arg == "-c" || arg == "--config" {
            index += 1;
            args.get(index).map(String::as_str)
        } else {
            arg.strip_prefix("--config=")
                .or_else(|| arg.strip_prefix("-c=").or_else(|| arg.strip_prefix("-c")))
        };
        if let Some(value) = override_value {
            match value.parse::<toml::Value>() {
                Ok(config) => configs.push(config),
                Err(_) => unknown = true,
            }
        }
        index += 1;
    }
    let existing = |name: &str| {
        configs.iter().any(|config| {
            config
                .get("mcp_servers")
                .and_then(|value| value.get(name))
                .is_some()
        })
    };
    let registry_names: std::collections::HashSet<_> =
        servers.iter().map(|server| server.name.clone()).collect();
    let mut disabled = Vec::new();
    servers.retain_mut(|server| {
        let alias = format!("{}-hivedeck", server.name);
        if unknown || (existing(&server.name) && (existing(&alias) || registry_names.contains(&alias))) {
            tracing::warn!(server = %server.name, "Skipping Codex registry server: unreadable configuration or alias already exists");
            return false;
        }
        if existing(&server.name) {
            disabled.push(server.name.clone());
            server.name = alias;
        }
        true
    });
    disabled
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry() -> RegistryEntry {
        RegistryEntry {
            name: "probe".into(),
            transport: "http".into(),
            command: None,
            args: vec![],
            url: Some("https://example.test/mcp".into()),
            headers: BTreeMap::from([("Authorization".into(), "probe-key".into())]),
            env: BTreeMap::new(),
            roles: vec!["crew".into()],
            boards: vec!["board-a".into()],
        }
    }

    #[test]
    fn new_executor_configs_match_complete_payloads() {
        let http = entry();
        let mut stdio = entry();
        stdio.name = "local".into();
        stdio.transport = "stdio".into();
        stdio.command = Some("runner".into());
        stdio.args = vec!["--mcp".into()];
        stdio.url = None;
        stdio.headers.clear();
        stdio.env.insert("API_KEY".into(), "probe-key".into());
        let secrets = BTreeMap::from([("probe-key".into(), "top-secret".into())]);
        let (servers, _) =
            select(vec![http, stdio], &secrets, "amp", "crew", Some("board-a")).unwrap();
        let http = json!({"url":"https://example.test/mcp","headers":{"Authorization":"Bearer ${HIVEDECK_MCP_PROBE_KEY_TOKEN}"}});
        let stdio = json!({"command":"runner","args":["--mcp"],"env":{"API_KEY":"${HIVEDECK_MCP_PROBE_KEY_TOKEN}"}});
        let parse = |text: String| serde_json::from_str::<Value>(&text).unwrap();
        assert_eq!(
            parse(amp_config(&servers)),
            json!({"probe":http,"local":stdio})
        );
        assert_eq!(
            parse(cursor_mcp_config(&servers)),
            json!({"mcpServers":{"probe":http,"local":stdio}})
        );
        let mut typed_http = http.clone();
        typed_http["type"] = json!("http");
        let mut typed_stdio = stdio.clone();
        typed_stdio["type"] = json!("stdio");
        assert_eq!(
            parse(droid_settings(&servers, Some(r#"{"other":true}"#))),
            json!({"other":true,"mcp":{"mcpServers":{"probe":typed_http,"local":typed_stdio}}})
        );
        typed_http["tools"] = json!(["*"]);
        typed_stdio["tools"] = json!(["*"]);
        assert_eq!(
            parse(copilot_config(&servers)),
            json!({"mcpServers":{"probe":typed_http,"local":typed_stdio}})
        );
    }

    #[test]
    fn scope_and_secret_references() {
        let secrets = BTreeMap::from([("probe-key".into(), "top-secret".into())]);
        for (cli, role, board) in [
            ("codex", "captain", Some("board-a")),
            ("codex", "crew", Some("board-b")),
            ("codex", "crew", None),
        ] {
            assert!(
                select(vec![entry()], &secrets, cli, role, board)
                    .unwrap()
                    .0
                    .is_empty()
            );
        }
        let (servers, vars) =
            select(vec![entry()], &secrets, "codex", "crew", Some("board-a")).unwrap();
        for cli in ["claude_code", "codex", "opencode"] {
            assert_eq!(
                select(vec![entry()], &secrets, cli, "crew", Some("board-a"))
                    .unwrap()
                    .0
                    .len(),
                1
            );
        }
        assert_eq!(vars["HIVEDECK_MCP_PROBE_KEY_TOKEN"], "top-secret");
        let claude = claude_config(
            &servers,
            Some(r#"{"mcpServers":{"hivedeck":{"url":"local"},"other":{"command":"x"}}}"#),
        );
        let opencode = opencode_config(&servers, Some(r#"{"mcp":{"other":{"type":"local"}}}"#));
        let codex_args = codex_args(&servers);
        assert_eq!(codex_args.len(), 2);
        let codex = codex_args.join(" ");
        let config: toml::Value = codex_args[1].parse().unwrap();
        assert!(claude.contains("Bearer ${HIVEDECK_MCP_PROBE_KEY_TOKEN}"));
        assert!(claude.contains("hivedeck") && claude.contains("other"));
        assert!(opencode.contains("Bearer {env:HIVEDECK_MCP_PROBE_KEY_TOKEN}"));
        assert!(opencode.contains("other"));
        assert_eq!(
            config["mcp_servers"]["probe"]["bearer_token_env_var"].as_str(),
            Some("HIVEDECK_MCP_PROBE_KEY_TOKEN")
        );
        let amp = amp_config(&servers);
        let copilot = copilot_config(&servers);
        let cursor = cursor_mcp_config(&servers);
        let droid = droid_settings(&servers, None);
        let gemini = gemini_family_settings(&servers, None, false);
        let qwen = gemini_family_settings(&servers, None, true);
        let amp_json: Value = serde_json::from_str(&amp).unwrap();
        assert!(amp_json.get("mcpServers").is_none());
        assert_eq!(
            amp_json["probe"]["headers"]["Authorization"].as_str(),
            Some("Bearer ${HIVEDECK_MCP_PROBE_KEY_TOKEN}")
        );
        let copilot_json: Value = serde_json::from_str(&copilot).unwrap();
        assert_eq!(copilot_json["mcpServers"]["probe"]["tools"], json!(["*"]));
        assert_eq!(copilot_json["mcpServers"]["probe"]["type"], json!("http"));
        let cursor_json: Value = serde_json::from_str(&cursor).unwrap();
        assert_eq!(
            cursor_json["mcpServers"]["probe"]["url"],
            json!("https://example.test/mcp")
        );
        let droid_json: Value = serde_json::from_str(&droid).unwrap();
        assert_eq!(
            droid_json["mcp"]["mcpServers"]["probe"]["type"],
            json!("http")
        );
        for output in [
            claude, opencode, codex, amp, copilot, cursor, droid, gemini, qwen,
        ] {
            assert!(!output.contains("top-secret"));
        }
    }

    #[test]
    fn stdio_and_reserved_name() {
        let mut local = entry();
        local.transport = "stdio".into();
        local.command = Some("runner".into());
        local.args = vec!["--mcp".into()];
        local.url = None;
        local.headers.clear();
        local.env.insert("API_KEY".into(), "probe-key".into());
        let mut reserved = local.clone();
        reserved.name = "hivedeck".into();
        let secrets = BTreeMap::from([("probe-key".into(), "top-secret".into())]);
        let (servers, _) = select(
            vec![local, reserved],
            &secrets,
            "codex",
            "crew",
            Some("board-a"),
        )
        .unwrap();
        assert_eq!(servers.len(), 1);
        let claude = claude_config(&servers, None);
        let codex_args = codex_args(&servers);
        assert_eq!(codex_args.len(), 2);
        let config: toml::Value = codex_args[1].parse().unwrap();
        let codex = codex_args.join(" ");
        let opencode = opencode_config(&servers, None);
        assert!(claude.contains("${HIVEDECK_MCP_PROBE_KEY_TOKEN}"));
        assert_eq!(
            config["mcp_servers"]["probe"]["env_vars"][0].as_str(),
            Some("HIVEDECK_MCP_PROBE_KEY_TOKEN")
        );
        assert_eq!(
            config["mcp_servers"]["probe"]["command"].as_str(),
            Some("/bin/sh")
        );
        assert!(
            config["mcp_servers"]["probe"]["args"][1]
                .as_str()
                .is_some_and(
                    |script| script.contains("export API_KEY=\"$HIVEDECK_MCP_PROBE_KEY_TOKEN\"")
                )
        );
        let amp = amp_config(&servers);
        let copilot = copilot_config(&servers);
        let cursor = cursor_mcp_config(&servers);
        let droid = droid_settings(&servers, None);
        assert_eq!(
            serde_json::from_str::<Value>(&amp).unwrap()["probe"]["env"]["API_KEY"],
            json!("${HIVEDECK_MCP_PROBE_KEY_TOKEN}")
        );
        let copilot_json: Value = serde_json::from_str(&copilot).unwrap();
        assert_eq!(copilot_json["mcpServers"]["probe"]["tools"], json!(["*"]));
        assert_eq!(
            copilot_json["mcpServers"]["probe"]["env"]["API_KEY"],
            json!("${HIVEDECK_MCP_PROBE_KEY_TOKEN}")
        );
        assert_eq!(
            serde_json::from_str::<Value>(&cursor).unwrap()["mcpServers"]["probe"]["env"]["API_KEY"],
            json!("${HIVEDECK_MCP_PROBE_KEY_TOKEN}")
        );
        assert_eq!(
            serde_json::from_str::<Value>(&droid).unwrap()["mcp"]["mcpServers"]["probe"]["env"]["API_KEY"],
            json!("${HIVEDECK_MCP_PROBE_KEY_TOKEN}")
        );
        assert!(opencode.contains("{env:HIVEDECK_MCP_PROBE_KEY_TOKEN}"));
        assert!(
            !format!("{claude}{codex}{opencode}{amp}{copilot}{cursor}{droid}")
                .contains("top-secret")
        );
    }

    #[test]
    fn captain_without_board_and_missing_secret() {
        let mut global = entry();
        global.boards.clear();
        global.roles = vec!["captain".into()];
        let secrets = BTreeMap::from([("probe-key".into(), "top-secret".into())]);
        assert_eq!(
            select(vec![global.clone()], &secrets, "codex", "captain", None)
                .unwrap()
                .0
                .len(),
            1
        );
        assert!(select(vec![global], &BTreeMap::new(), "codex", "captain", None).is_err());
    }

    #[test]
    fn codex_skips_conflicting_transport_with_safe_warning() {
        use std::{
            io::Write,
            sync::{Arc, Mutex},
        };

        if std::env::var_os("HIVEDECK_TEST_CODEX_WARNING").is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "mcp_registry::tests::codex_skips_conflicting_transport_with_safe_warning",
                    "--nocapture",
                ])
                .env("HIVEDECK_TEST_CODEX_WARNING", "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stdout)
            );
            return;
        }
        struct Writer(Arc<Mutex<Vec<u8>>>);
        impl Write for Writer {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(bytes);
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let output = Arc::new(Mutex::new(Vec::new()));
        let subscriber = tracing_subscriber::fmt()
            .with_ansi(false)
            .without_time()
            .with_writer({
                let output = output.clone();
                move || Writer(output.clone())
            })
            .finish();
        let _guard = tracing::subscriber::set_default(subscriber);
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config.toml");
        std::fs::write(&config, "[mcp_servers.probe]\ncommand = 'old-server'\n[mcp_servers.probe-hivedeck]\ncommand = 'other'\n").unwrap();
        let secrets = BTreeMap::from([("probe-key".into(), "top-secret".into())]);
        let (mut servers, _) =
            select(vec![entry()], &secrets, "codex", "crew", Some("board-a")).unwrap();
        filter_codex_conflicts(&mut servers, &[config], &[]);
        assert!(servers.is_empty());
        assert!(codex_args(&servers).is_empty());
        let warning = String::from_utf8(output.lock().unwrap().clone()).unwrap();
        assert!(warning.contains("Skipping Codex registry server") && warning.contains("probe"));
        assert!(!warning.contains("top-secret"));
    }

    #[test]
    fn codex_renames_http_over_stdio_and_preserves_unmatched_names() {
        let secrets = BTreeMap::from([("probe-key".into(), "top-secret".into())]);
        let (mut servers, _) =
            select(vec![entry()], &secrets, "codex", "crew", Some("board-a")).unwrap();
        assert!(filter_codex_conflicts(&mut servers, &[], &[]).is_empty());
        assert_eq!(servers[0].name, "probe");
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config.toml");
        std::fs::write(&config, "[mcp_servers.probe]\ncommand='old-server'\n").unwrap();
        let disabled = filter_codex_conflicts(&mut servers, &[config], &[]);
        let args = [codex_disable_args(&disabled), codex_args(&servers)].concat();
        let old: toml::Value = args[1].parse().unwrap();
        let new: toml::Value = args[3].parse().unwrap();
        assert_eq!(
            old["mcp_servers"]["probe"]["enabled"].as_bool(),
            Some(false)
        );
        assert!(new["mcp_servers"]["probe-hivedeck"]["url"].is_str());
        assert!(!args.join(" ").contains("top-secret"));
    }

    #[test]
    fn codex_checks_reverse_transport_and_command_line_overrides() {
        let mut local = entry();
        local.transport = "stdio".into();
        local.command = Some("runner".into());
        local.url = None;
        local.headers.clear();
        let (mut servers, _) = select(
            vec![local],
            &BTreeMap::new(),
            "codex",
            "crew",
            Some("board-a"),
        )
        .unwrap();
        let disabled = filter_codex_conflicts(
            &mut servers,
            &[],
            &[
                "-c".into(),
                "mcp_servers.probe.url='https://example.test'".into(),
            ],
        );
        assert_eq!(disabled, ["probe"]);
        assert_eq!(servers[0].name, "probe-hivedeck");
    }

    #[test]
    fn codex_renames_matching_transport_and_skips_unreadable_config() {
        let secrets = BTreeMap::from([("probe-key".into(), "top-secret".into())]);
        let (mut servers, _) =
            select(vec![entry()], &secrets, "codex", "crew", Some("board-a")).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config.toml");
        std::fs::write(&config, "[mcp_servers.probe]\nurl='https://old.example'\n").unwrap();
        let disabled = filter_codex_conflicts(&mut servers, std::slice::from_ref(&config), &[]);
        assert_eq!(disabled, ["probe"]);
        assert_eq!(servers[0].name, "probe-hivedeck");
        let args = [codex_disable_args(&disabled), codex_args(&servers)].concat();
        let old: toml::Value = args[1].parse().unwrap();
        let new: toml::Value = args[3].parse().unwrap();
        assert_eq!(
            old["mcp_servers"]["probe"]["enabled"].as_bool(),
            Some(false)
        );
        assert_eq!(
            new["mcp_servers"]["probe-hivedeck"]["bearer_token_env_var"].as_str(),
            Some("HIVEDECK_MCP_PROBE_KEY_TOKEN")
        );
        assert!(!args.join(" ").contains("top-secret"));
        std::fs::write(&config, "invalid = [").unwrap();
        filter_codex_conflicts(&mut servers, &[config], &[]);
        assert!(servers.is_empty());
    }
}
