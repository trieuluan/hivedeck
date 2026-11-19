use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};

use executors::{
    mcp_registry,
    plugins::{
        self, InstallPluginRequest, UpgradePluginRequest, cleanup_run_skills,
        materialize_run_skills, opencode_skills_config, read_plugin_secrets, read_plugins,
        select_mcp_for_run, select_skills_for_run, set_plugin_enabled, uninstall_plugin,
        update_skill_scope,
    },
};
use serde_json::Value;
use tempfile::TempDir;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample-plugin")
}

fn copy_dir_all(src: &Path, dst: &Path) {
    for entry in walkdir::WalkDir::new(src) {
        let entry = entry.unwrap();
        let rel = entry.path().strip_prefix(src).unwrap();
        let target = dst.join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target).unwrap();
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::copy(entry.path(), &target).unwrap();
        }
    }
}

fn find_binary(name: &str) -> Option<PathBuf> {
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    if name == "opencode"
        && let Some(home) = std::env::var_os("HOME")
    {
        let npx_dir = PathBuf::from(home).join(".npm/_npx");
        if let Ok(entries) = std::fs::read_dir(npx_dir) {
            for entry in entries.flatten() {
                let candidate = entry.path().join("node_modules/.bin/opencode");
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

async fn start_mock_llm_server() -> (u16, Arc<Mutex<Vec<String>>>, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let bodies = Arc::new(Mutex::new(Vec::new()));
    let captured = bodies.clone();
    let handle = tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            let captured = captured.clone();
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut tmp = [0u8; 8192];
                let mut header_end = None;
                let mut content_length = 0usize;
                let mut is_chunked = false;
                loop {
                    let Ok(n) = socket.read(&mut tmp).await else {
                        return;
                    };
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                    if header_end.is_none()
                        && let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n")
                    {
                        let end = pos + 4;
                        header_end = Some(end);
                        let headers = String::from_utf8_lossy(&buf[..pos]);
                        for line in headers.lines() {
                            let lower = line.to_ascii_lowercase();
                            if let Some(val) = lower.strip_prefix("content-length:") {
                                content_length = val.trim().parse().unwrap_or(0);
                            }
                            if lower.starts_with("transfer-encoding:") && lower.contains("chunked")
                            {
                                is_chunked = true;
                            }
                        }
                    }
                    if let Some(end) = header_end {
                        if is_chunked {
                            if buf[end..].windows(5).any(|w| w == b"0\r\n\r\n") {
                                break;
                            }
                        } else if buf.len() >= end + content_length {
                            break;
                        }
                    }
                }
                if let Some(end) = header_end {
                    let body = String::from_utf8_lossy(&buf[end..]).to_string();
                    if !body.is_empty() {
                        captured.lock().unwrap().push(body);
                    }
                }
                let resp = "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: 42\r\nConnection: close\r\n\r\n{\"error\":{\"message\":\"mock probe stop\"}}";
                let _ = socket.write_all(resp.as_bytes()).await;
            });
        }
    });
    (port, bodies, handle)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn plugin_injection_across_clis_hash_stability_and_uninstall() {
    let asset_dir = TempDir::new().unwrap();
    let src_root = TempDir::new().unwrap();
    let plugin_src = src_root.path().join("sample-plugin");
    copy_dir_all(&fixture_dir(), &plugin_src);

    let installed = plugins::install_plugin(
        asset_dir.path(),
        InstallPluginRequest {
            source: plugin_src.to_string_lossy().to_string(),
            version: Some("1.0.0".into()),
            roles: Some(vec!["crew".into()]),
            boards: Some(vec!["board-1".into()]),
            secrets: BTreeMap::from([(
                "fixture-tool".into(),
                BTreeMap::from([("FIXTURE_API_KEY".into(), "secret-fixture-value".into())]),
            )]),
            ..Default::default()
        },
    )
    .unwrap();
    let initial_hash = installed.asset_hash.clone();

    // Hash stability without upgrade across enable/disable and scope changes.
    set_plugin_enabled(asset_dir.path(), "sample-plugin", false).unwrap();
    let after_disable = read_plugins(asset_dir.path()).unwrap();
    assert_eq!(after_disable[0].asset_hash, initial_hash);
    set_plugin_enabled(asset_dir.path(), "sample-plugin", true).unwrap();
    update_skill_scope(
        asset_dir.path(),
        "sample-plugin",
        "fixture-skill",
        Some(vec!["crew".into(), "captain".into()]),
        Some(vec!["board-1".into()]),
        Some(vec![]),
        Some(true),
    )
    .unwrap();
    let after_scope = read_plugins(asset_dir.path()).unwrap();
    assert_eq!(after_scope[0].asset_hash, initial_hash);

    // Ensure upgrade error does not mutate installed hash.
    assert!(
        plugins::upgrade_plugin(
            asset_dir.path(),
            "sample-plugin",
            UpgradePluginRequest {
                version: Some("9.9.9".into()),
                ..Default::default()
            }
        )
        .is_err()
    );
    assert_eq!(
        read_plugins(asset_dir.path()).unwrap()[0].asset_hash,
        initial_hash
    );

    let plugins_list = read_plugins(asset_dir.path()).unwrap();
    let plugin_secrets = read_plugin_secrets(asset_dir.path()).unwrap();
    let empty_registry: Vec<mcp_registry::RegistryEntry> = Vec::new();
    let empty_secrets: BTreeMap<String, String> = BTreeMap::new();

    // 1. Claude Code selection & materialization.
    let (claude_servers, claude_vars) = select_mcp_for_run(
        asset_dir.path(),
        empty_registry.clone(),
        &empty_secrets,
        &plugins_list,
        &plugin_secrets,
        "claude_code",
        "crew",
        Some("board-1"),
    )
    .unwrap();
    let claude_skills = select_skills_for_run(
        asset_dir.path(),
        &plugins_list,
        "claude_code",
        "crew",
        Some("board-1"),
    );
    let claude_skill_dirs = materialize_run_skills(
        asset_dir.path(),
        "run-claude",
        "claude_code",
        &claude_skills,
    )
    .unwrap();
    let claude_mcp_cfg = mcp_registry::claude_config(&claude_servers, None);
    assert!(claude_mcp_cfg.contains("fixture-tool"));
    assert!(!claude_mcp_cfg.contains("secret-fixture-value"));
    assert!(
        claude_skill_dirs[0]
            .join(".claude/skills/fixture-skill/SKILL.md")
            .is_file()
    );

    // 2. Codex selection & materialization (no unsupported skill path arg).
    let (codex_servers, codex_vars) = select_mcp_for_run(
        asset_dir.path(),
        empty_registry.clone(),
        &empty_secrets,
        &plugins_list,
        &plugin_secrets,
        "codex",
        "crew",
        Some("board-1"),
    )
    .unwrap();
    let codex_skills = select_skills_for_run(
        asset_dir.path(),
        &plugins_list,
        "codex",
        "crew",
        Some("board-1"),
    );
    let codex_skill_dirs =
        materialize_run_skills(asset_dir.path(), "run-codex", "codex", &codex_skills).unwrap();
    assert!(codex_skill_dirs.is_empty());
    let codex_mcp_args = mcp_registry::codex_args(&codex_servers);
    assert!(!codex_mcp_args.join(" ").contains("secret-fixture-value"));

    // 3. OpenCode selection & materialization.
    let (opencode_servers, opencode_vars) = select_mcp_for_run(
        asset_dir.path(),
        empty_registry,
        &empty_secrets,
        &plugins_list,
        &plugin_secrets,
        "opencode",
        "crew",
        Some("board-1"),
    )
    .unwrap();
    let opencode_skills = select_skills_for_run(
        asset_dir.path(),
        &plugins_list,
        "opencode",
        "crew",
        Some("board-1"),
    );
    let opencode_skill_dirs = materialize_run_skills(
        asset_dir.path(),
        "run-opencode",
        "opencode",
        &opencode_skills,
    )
    .unwrap();
    let opencode_cfg = opencode_skills_config(
        &opencode_skill_dirs,
        Some(&mcp_registry::opencode_config(&opencode_servers, None)),
    );
    assert!(opencode_cfg.contains("fixture-tool"));
    assert!(!opencode_cfg.contains("secret-fixture-value"));
    assert!(
        opencode_skill_dirs[0]
            .join("fixture-skill/SKILL.md")
            .is_file()
    );

    // Live CLI probes when binaries are present locally.
    if let Some(claude_bin) = find_binary("claude") {
        eprintln!("probing claude: {}", claude_bin.display());
        let (port, bodies, server_task) = start_mock_llm_server().await;
        let home = TempDir::new().unwrap();
        let mut cmd = tokio::process::Command::new(&claude_bin);
        cmd.stdin(Stdio::null())
            .args([
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--no-session-persistence",
                "--model",
                "claude-sonnet-4-5",
                "--strict-mcp-config",
                &format!("--mcp-config={claude_mcp_cfg}"),
                &format!("--add-dir={}", claude_skill_dirs[0].display()),
                "Reply with OK",
            ])
            .current_dir(home.path())
            .env("HOME", home.path())
            .env("ANTHROPIC_BASE_URL", format!("http://127.0.0.1:{port}"))
            .env("ANTHROPIC_API_KEY", "probe-dummy");
        for (k, v) in &claude_vars {
            cmd.env(k, v);
        }
        let output = tokio::time::timeout(Duration::from_secs(30), cmd.kill_on_drop(true).output())
            .await
            .expect("CLI probe timed out")
            .unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        server_task.abort();
        assert!(
            stdout.contains("fixture-skill"),
            "claude init missing fixture-skill:\nstdout={stdout}\nstderr={stderr}"
        );
        let joined = bodies.lock().unwrap().join("\n");
        assert!(
            joined.contains("mcp__fixture-tool__fixture_ping"),
            "claude mock server missing mcp__fixture-tool__fixture_ping:\nbodies={joined}\nstdout={stdout}\nstderr={stderr}"
        );
        assert!(
            joined.contains("(authed)"),
            "claude MCP server did not receive secret FIXTURE_TOKEN:\nbodies={joined}"
        );
    }

    if let Some(codex_bin) = find_binary("codex") {
        eprintln!("probing codex: {}", codex_bin.display());
        let (port, bodies, server_task) = start_mock_llm_server().await;
        let home = TempDir::new().unwrap();
        let codex_home = home.path().join(".codex");
        std::fs::create_dir_all(&codex_home).unwrap();
        let mut cmd = tokio::process::Command::new(&codex_bin);
        cmd.stdin(Stdio::null()).args([
            "exec",
            "--skip-git-repo-check",
            "--ephemeral",
            "-s",
            "read-only",
            "-m",
            "gpt-5",
            "-c",
            "model_provider=\"probe\"",
            "-c",
            &format!(
                "model_providers.probe={{name=\"probe\",base_url=\"http://127.0.0.1:{port}\",wire_api=\"responses\"}}"
            ),
        ])
        .args(&codex_mcp_args)
        .arg("Reply with OK")
        .current_dir(home.path())
        .env("HOME", home.path())
        .env("CODEX_HOME", &codex_home)
        .env("OPENAI_API_KEY", "probe-dummy");
        for (k, v) in &codex_vars {
            cmd.env(k, v);
        }
        let output = tokio::time::timeout(Duration::from_secs(30), cmd.kill_on_drop(true).output())
            .await
            .expect("CLI probe timed out")
            .unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        server_task.abort();
        let joined = bodies.lock().unwrap().join("\n");
        assert!(
            joined.contains("fixture_ping") || joined.contains("fixture-tool"),
            "codex mock server missing fixture-tool/fixture_ping:\nbodies={joined}\nstdout={stdout}\nstderr={stderr}"
        );
        assert!(
            joined.contains("(authed)"),
            "codex MCP server check:\nbodies={joined}"
        );
    }

    if let Some(opencode_bin) = find_binary("opencode") {
        eprintln!("probing opencode: {}", opencode_bin.display());
        let home = TempDir::new().unwrap();
        let skill_check = tokio::process::Command::new(&opencode_bin)
            .args(["--pure", "debug", "skill"])
            .current_dir(home.path())
            .env("HOME", home.path())
            .env("OPENCODE_CONFIG_CONTENT", &opencode_cfg)
            .kill_on_drop(true)
            .output()
            .await
            .unwrap();
        let skill_stdout = String::from_utf8_lossy(&skill_check.stdout);
        let skill_stderr = String::from_utf8_lossy(&skill_check.stderr);
        assert!(
            skill_stdout.contains("fixture-skill"),
            "opencode debug skill missing fixture-skill:\nstdout={skill_stdout}\nstderr={skill_stderr}"
        );

        let (port, bodies, server_task) = start_mock_llm_server().await;
        let mut full_cfg: Value = serde_json::from_str(&opencode_cfg).unwrap();
        full_cfg["provider"] = serde_json::json!({
            "probe": {
                "npm": "@ai-sdk/openai-compatible",
                "options": {
                    "baseURL": format!("http://127.0.0.1:{port}"),
                    "apiKey": "probe-dummy"
                },
                "models": {
                    "gpt-5": {}
                }
            }
        });
        let mut cmd = tokio::process::Command::new(&opencode_bin);
        cmd.stdin(Stdio::null())
            .args(["--pure", "run", "-m", "probe/gpt-5", "Reply with OK"])
            .current_dir(home.path())
            .env("HOME", home.path())
            .env("OPENCODE_CONFIG_CONTENT", full_cfg.to_string());
        for (k, v) in &opencode_vars {
            cmd.env(k, v);
        }
        let output = tokio::time::timeout(Duration::from_secs(20), cmd.kill_on_drop(true).output())
            .await
            .expect("opencode timed out")
            .unwrap();
        server_task.abort();
        let joined = bodies.lock().unwrap().join("\n");
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            joined.contains("fixture_ping"),
            "opencode mock server missing fixture_ping:\nbodies={joined}\nstdout={stdout}\nstderr={stderr}"
        );
        assert!(
            joined.contains("(authed)"),
            "opencode MCP server did not receive secret FIXTURE_TOKEN:\nbodies={joined}"
        );
    }

    // Cleanup run skills + uninstall leaves original source untouched.
    cleanup_run_skills(asset_dir.path(), "run-claude");
    cleanup_run_skills(asset_dir.path(), "run-codex");
    cleanup_run_skills(asset_dir.path(), "run-opencode");
    assert!(!asset_dir.path().join("run_skills/run-claude").exists());

    uninstall_plugin(asset_dir.path(), "sample-plugin").unwrap();
    assert!(read_plugins(asset_dir.path()).unwrap().is_empty());
    assert!(read_plugin_secrets(asset_dir.path()).unwrap().is_empty());
    assert!(!asset_dir.path().join("plugins/sample-plugin").exists());
    assert!(plugin_src.join(".claude-plugin/plugin.json").is_file());
    assert!(plugin_src.join("skills/fixture-skill/SKILL.md").is_file());
}
