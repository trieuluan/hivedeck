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

pub fn codex_args(servers: &[InjectedMcpServer]) -> Vec<String> {
    let mut args = Vec::new();
    for server in servers {
        let prefix = format!("mcp_servers.{}", toml::Value::String(server.name.clone()));
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
                format!(
                    "mcp_servers.{}.enabled=false",
                    toml::Value::String(name.clone())
                ),
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
        for output in [claude, opencode, codex] {
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
            Some("API_KEY")
        );
        assert!(opencode.contains("{env:HIVEDECK_MCP_PROBE_KEY_TOKEN}"));
        assert!(!format!("{claude}{codex}{opencode}").contains("top-secret"));
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
