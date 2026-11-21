use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    process::Command,
    sync::Mutex,
};

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use strum::IntoEnumIterator;
use tempfile::TempDir;
use ts_rs::TS;
use uuid::Uuid;

use crate::{
    executors::BaseCodingAgent,
    mcp_registry::{self, InjectedMcpServer, RegistryEntry},
};

static WRITE_LOCK: Mutex<()> = Mutex::new(());

const KNOWN_CLIS: [&str; 9] = [
    "claude_code",
    "codex",
    "opencode",
    "amp",
    "gemini",
    "cursor_agent",
    "qwen_code",
    "copilot",
    "droid",
];

fn default_true() -> bool {
    true
}

fn default_roles() -> Vec<String> {
    vec!["crew".to_string()]
}

#[derive(Debug, thiserror::Error)]
pub enum PluginError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    NotFound(String),
    #[error("Plugin conflict")]
    Conflict(Vec<PluginConflict>),
    #[error("{0}")]
    ConflictMessage(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ConflictPolicy {
    #[default]
    Abort,
    Skip,
    Overwrite,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PluginConflict {
    pub kind: String,
    pub name: String,
    pub against: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum McpToolPolicy {
    Default,
    Allow,
    Ask,
    Block,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PluginMcpEntry {
    pub name: String,
    pub transport: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default = "default_roles")]
    pub roles: Vec<String>,
    #[serde(default)]
    pub boards: Vec<String>,
    #[serde(default)]
    pub oauth: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tool_policies: BTreeMap<String, McpToolPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_instructions: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PluginSkillEntry {
    pub name: String,
    pub path: String,
    #[serde(default = "default_roles")]
    pub roles: Vec<String>,
    #[serde(default)]
    pub boards: Vec<String>,
    #[serde(default)]
    pub clis: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct InstalledPlugin {
    pub name: String,
    pub version: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub asset_hash: String,
    #[serde(default)]
    pub mcp: Vec<PluginMcpEntry>,
    #[serde(default)]
    pub skills: Vec<PluginSkillEntry>,
    #[serde(default)]
    pub unsupported: Vec<String>,
    #[serde(default)]
    pub notes: Vec<PluginConflict>,
}

pub type PluginsSecrets = BTreeMap<String, BTreeMap<String, BTreeMap<String, String>>>;

#[derive(Clone, Debug, Default, Deserialize, TS)]
pub struct InstallPluginRequest {
    pub source: String,
    #[serde(default)]
    #[ts(optional)]
    pub single_mcp: Option<PluginMcpEntry>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub commit: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub roles: Option<Vec<String>>,
    #[serde(default)]
    pub boards: Option<Vec<String>>,
    #[serde(default)]
    pub skill_clis: Option<Vec<String>>,
    #[serde(default)]
    pub conflict_policy: ConflictPolicy,
    #[serde(default)]
    pub secrets: BTreeMap<String, BTreeMap<String, String>>,
}

#[derive(Clone, Debug, Default, Deserialize, TS)]
pub struct UpgradePluginRequest {
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub commit: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub conflict_policy: ConflictPolicy,
}

#[derive(Clone, Debug)]
pub struct SelectedSkill {
    pub plugin_name: String,
    pub name: String,
    pub source_skill_dir: PathBuf,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum InjectionSupport {
    Supported,
    PromptCatalog,
    Unsupported,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ExecutorCompatibility {
    pub executor: BaseCodingAgent,
    pub cli: Option<String>,
    pub mcp: InjectionSupport,
    pub mcp_mechanism: String,
    pub skills: InjectionSupport,
    pub skills_mechanism: String,
}

pub fn plugin_cli_key(agent: BaseCodingAgent) -> Option<&'static str> {
    match agent {
        BaseCodingAgent::ClaudeCode | BaseCodingAgent::ClaudeCodeHeaded => Some("claude_code"),
        BaseCodingAgent::Codex => Some("codex"),
        BaseCodingAgent::Opencode | BaseCodingAgent::OpencodeHeaded => Some("opencode"),
        BaseCodingAgent::Gemini => Some("gemini"),
        BaseCodingAgent::QwenCode => Some("qwen_code"),
        BaseCodingAgent::Amp => Some("amp"),
        BaseCodingAgent::CursorAgent => Some("cursor_agent"),
        BaseCodingAgent::Copilot => Some("copilot"),
        BaseCodingAgent::Droid => Some("droid"),
        #[cfg(feature = "qa-mode")]
        BaseCodingAgent::QaMock => None,
    }
}

pub fn executor_compatibility_for(agent: BaseCodingAgent) -> ExecutorCompatibility {
    let cli = plugin_cli_key(agent).map(str::to_string);
    match agent {
        BaseCodingAgent::ClaudeCode | BaseCodingAgent::ClaudeCodeHeaded => ExecutorCompatibility {
            executor: agent,
            cli,
            mcp: InjectionSupport::Supported,
            mcp_mechanism: "--mcp-config".into(),
            skills: InjectionSupport::Supported,
            skills_mechanism: "--add-dir".into(),
        },
        BaseCodingAgent::Codex => ExecutorCompatibility {
            executor: agent,
            cli,
            mcp: InjectionSupport::Supported,
            mcp_mechanism: "-c mcp_servers.*".into(),
            skills: InjectionSupport::Unsupported,
            skills_mechanism: "Codex CLI has no per-run skill directory flag".into(),
        },
        BaseCodingAgent::Opencode | BaseCodingAgent::OpencodeHeaded => ExecutorCompatibility {
            executor: agent,
            cli,
            mcp: InjectionSupport::Supported,
            mcp_mechanism: "OPENCODE_CONFIG_CONTENT".into(),
            skills: InjectionSupport::Supported,
            skills_mechanism: "OPENCODE_CONFIG_CONTENT (skills.paths)".into(),
        },
        BaseCodingAgent::Gemini => ExecutorCompatibility {
            executor: agent,
            cli,
            mcp: InjectionSupport::Supported,
            mcp_mechanism: "GEMINI_CLI_SYSTEM_SETTINGS_PATH".into(),
            skills: InjectionSupport::PromptCatalog,
            skills_mechanism: "--include-directories + prompt catalog".into(),
        },
        BaseCodingAgent::QwenCode => ExecutorCompatibility {
            executor: agent,
            cli,
            mcp: InjectionSupport::Supported,
            mcp_mechanism: "QWEN_CODE_SYSTEM_SETTINGS_PATH".into(),
            skills: InjectionSupport::PromptCatalog,
            skills_mechanism: "--include-directories + prompt catalog".into(),
        },
        BaseCodingAgent::Amp => ExecutorCompatibility {
            executor: agent,
            cli,
            mcp: InjectionSupport::Supported,
            mcp_mechanism: "--mcp-config".into(),
            skills: InjectionSupport::PromptCatalog,
            skills_mechanism: "Prompt catalog (no non-clobbering per-run skill flag)".into(),
        },
        BaseCodingAgent::CursorAgent => ExecutorCompatibility {
            executor: agent,
            cli,
            mcp: InjectionSupport::Supported,
            mcp_mechanism: "--plugin-dir (.mcp.json)".into(),
            skills: InjectionSupport::Supported,
            skills_mechanism: "--plugin-dir (skills/)".into(),
        },
        BaseCodingAgent::Copilot => ExecutorCompatibility {
            executor: agent,
            cli,
            mcp: InjectionSupport::Supported,
            mcp_mechanism: "--additional-mcp-config".into(),
            skills: InjectionSupport::Supported,
            skills_mechanism: "COPILOT_SKILLS_DIRS + --add-dir".into(),
        },
        BaseCodingAgent::Droid => ExecutorCompatibility {
            executor: agent,
            cli,
            mcp: InjectionSupport::Supported,
            mcp_mechanism: "--settings (mcp.mcpServers)".into(),
            skills: InjectionSupport::PromptCatalog,
            skills_mechanism: "Prompt catalog (--settings skills uses internal schema)".into(),
        },
        #[cfg(feature = "qa-mode")]
        BaseCodingAgent::QaMock => ExecutorCompatibility {
            executor: agent,
            cli,
            mcp: InjectionSupport::Unsupported,
            mcp_mechanism: "Internal QA mock executor".into(),
            skills: InjectionSupport::Unsupported,
            skills_mechanism: "Internal QA mock executor".into(),
        },
    }
}

pub fn executor_compatibility() -> Vec<ExecutorCompatibility> {
    BaseCodingAgent::iter()
        .map(executor_compatibility_for)
        .collect()
}

pub fn cli_supports_skills(cli: &str) -> bool {
    matches!(
        cli,
        "claude_code"
            | "opencode"
            | "gemini"
            | "qwen_code"
            | "amp"
            | "cursor_agent"
            | "copilot"
            | "droid"
    )
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn validate_roles(roles: &[String]) -> Result<(), PluginError> {
    if roles.is_empty()
        || roles
            .iter()
            .any(|role| !matches!(role.as_str(), "captain" | "crew"))
    {
        return Err(PluginError::BadRequest(
            "Invalid role scope; expected captain and/or crew".into(),
        ));
    }
    Ok(())
}

fn validate_clis(clis: &[String]) -> Result<(), PluginError> {
    if clis.iter().any(|cli| !KNOWN_CLIS.contains(&cli.as_str())) {
        return Err(PluginError::BadRequest("Invalid CLI target".into()));
    }
    Ok(())
}

pub fn plugins_path(dir: &Path) -> PathBuf {
    dir.join("plugins.json")
}

pub fn secrets_path(dir: &Path) -> PathBuf {
    dir.join("plugins_secrets.json")
}

pub fn plugin_asset_dir(dir: &Path, name: &str) -> PathBuf {
    dir.join("plugins").join(name)
}

pub fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> Result<T, PluginError> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid plugin store file").into()
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error.into()),
    }
}

fn write_atomic<T: Serialize>(path: &Path, value: &T, secret: bool) -> Result<(), PluginError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(std::io::Error::other)?;
    let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        if secret {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        #[cfg(unix)]
        if secret {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        #[cfg(not(unix))]
        let _ = secret;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&temp, path)?;
        #[cfg(unix)]
        if let Some(parent) = path.parent() {
            fs::File::open(parent)?.sync_all()?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result.map_err(Into::into)
}

pub fn read_plugins(dir: &Path) -> Result<Vec<InstalledPlugin>, PluginError> {
    read_json_or_default(&plugins_path(dir))
}

pub fn read_plugin_secrets(dir: &Path) -> Result<PluginsSecrets, PluginError> {
    read_json_or_default(&secrets_path(dir))
}

pub fn extract_skill_description(markdown: &str) -> Option<String> {
    let trimmed = markdown.trim_start();
    if let Some(after_open) = trimmed.strip_prefix("---") {
        let end = after_open.find("\n---")?;
        let frontmatter = &after_open[..end];
        let mut lines = frontmatter.lines().peekable();
        while let Some(line) = lines.next() {
            let line_trimmed = line.trim_start();
            if let Some(rest) = line_trimmed.strip_prefix("description:") {
                let value = rest.trim();
                if value == "|" || value == ">" || value == "|-" || value == ">-" {
                    let mut collected = Vec::new();
                    while let Some(next_line) = lines.peek() {
                        if next_line.starts_with(' ') || next_line.starts_with('\t') {
                            collected.push(next_line.trim());
                            lines.next();
                        } else {
                            break;
                        }
                    }
                    let joined = collected.join(" ").trim().to_owned();
                    if !joined.is_empty() {
                        return Some(joined);
                    }
                } else {
                    let unquoted = value.trim_matches('"').trim_matches('\'').trim();
                    if !unquoted.is_empty() {
                        return Some(unquoted.to_owned());
                    }
                }
            }
        }
    }
    None
}

pub fn read_plugin_skill_descriptions(
    asset_dir: &Path,
    plugin: &InstalledPlugin,
) -> BTreeMap<String, String> {
    let root = plugin_asset_dir(asset_dir, &plugin.name);
    let mut descriptions = BTreeMap::new();
    for skill in &plugin.skills {
        let skill_path = root.join(&skill.path);
        if let Ok(content) = fs::read_to_string(&skill_path)
            && let Some(desc) = extract_skill_description(&content)
        {
            descriptions.insert(skill.name.clone(), desc);
        }
    }
    descriptions
}

pub fn migrate_mcp_registry(dir: &Path) -> Result<(), PluginError> {
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Plugin registry lock poisoned"))?;
    let path = dir.join("mcp_registry.json");
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let entries: Vec<PluginMcpEntry> = serde_json::from_slice(&bytes)
        .map_err(|_| PluginError::BadRequest("Invalid legacy MCP registry".into()))?;
    let legacy_secrets: BTreeMap<String, String> =
        read_json_or_default(&dir.join("mcp_secrets.json"))?;
    let mut plugins = read_plugins(dir)?;
    let mut secrets = read_plugin_secrets(dir)?;
    let mut seen = BTreeSet::new();
    for entry in entries {
        validate_mcp_entry(&entry)?;
        if !seen.insert(entry.name.clone()) {
            return Err(PluginError::ConflictMessage(format!(
                "Duplicate legacy MCP: {}",
                entry.name
            )));
        }
        let name = entry.name.clone();
        let plugin = single_mcp_plugin(entry.clone(), &InstallPluginRequest::default())?;
        match plugins.iter().find(|existing| existing.name == name) {
            Some(existing) if existing == &plugin => (),
            Some(_) => {
                return Err(PluginError::ConflictMessage(format!(
                    "Plugin name already exists: {name}"
                )));
            }
            None => {
                if plugins
                    .iter()
                    .any(|existing| existing.mcp.iter().any(|server| server.name == name))
                {
                    return Err(PluginError::ConflictMessage(format!(
                        "MCP name already exists: {name}"
                    )));
                }
                plugins.push(plugin);
            }
        }
        for reference in entry.headers.values().chain(entry.env.values()) {
            if let Some(value) = legacy_secrets.get(reference) {
                let target = secrets
                    .entry(name.clone())
                    .or_default()
                    .entry(name.clone())
                    .or_default();
                if target
                    .get(reference)
                    .is_some_and(|existing| existing != value)
                {
                    return Err(PluginError::ConflictMessage(format!(
                        "Secret collision for MCP {name}"
                    )));
                }
                target.insert(reference.clone(), value.clone());
            }
        }
    }
    let backup = dir.join("mcp_registry.json.bak");
    match fs::read(&backup) {
        Ok(existing) if existing != bytes => {
            return Err(PluginError::ConflictMessage(
                "Legacy MCP backup already exists with different contents".into(),
            ));
        }
        Ok(_) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut file = tempfile::NamedTempFile::new_in(dir)?;
            file.write_all(&bytes)?;
            file.as_file().sync_all()?;
            file.persist_noclobber(&backup)
                .map_err(|error| error.error)?;
            #[cfg(unix)]
            fs::File::open(dir)?.sync_all()?;
        }
        Err(error) => return Err(error.into()),
    }
    write_atomic(&secrets_path(dir), &secrets, true)?;
    write_atomic(&plugins_path(dir), &plugins, false)?;
    fs::remove_file(path)?;
    #[cfg(unix)]
    fs::File::open(dir)?.sync_all()?;
    Ok(())
}

fn is_remote_source(source: &str) -> bool {
    source.starts_with("http://")
        || source.starts_with("https://")
        || source.starts_with("ssh://")
        || source.starts_with("git://")
        || source.starts_with("file://")
        || source.starts_with("git@")
}

fn validate_commit_pin(commit: &str) -> Result<(), PluginError> {
    if !(7..=40).contains(&commit.len()) || !commit.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(PluginError::BadRequest(
            "Invalid commit pin: expected 7-40 hex characters".into(),
        ));
    }
    Ok(())
}

fn validate_tag_pin(tag: &str) -> Result<(), PluginError> {
    if tag.is_empty()
        || tag.starts_with('-')
        || tag.contains("..")
        || tag.chars().any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(PluginError::BadRequest("Invalid tag pin".into()));
    }
    Ok(())
}

fn copy_dir_filtered(src: &Path, dst: &Path) -> Result<(), PluginError> {
    let canonical_root = fs::canonicalize(src)?;
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if name == ".git" {
            continue;
        }
        let path = entry.path();
        let meta = fs::symlink_metadata(&path)?;
        if meta.file_type().is_symlink() {
            let resolved = fs::canonicalize(&path)
                .map_err(|_| PluginError::BadRequest("Plugin contains broken symlink".into()))?;
            if !resolved.starts_with(&canonical_root) {
                return Err(PluginError::BadRequest(
                    "Plugin symlink escapes source directory".into(),
                ));
            }
            if resolved.is_dir() {
                copy_dir_filtered(&resolved, &dst.join(&name))?;
            } else {
                fs::copy(&resolved, dst.join(&name))?;
            }
        } else if meta.is_dir() {
            copy_dir_filtered(&path, &dst.join(&name))?;
        } else if meta.is_file() {
            fs::copy(&path, dst.join(&name))?;
        }
    }
    Ok(())
}

fn stage_source(
    source: &str,
    commit: Option<&str>,
    tag: Option<&str>,
    allow_marketplace_head: bool,
) -> Result<(TempDir, PathBuf, Option<String>, Option<String>), PluginError> {
    let original = source.trim();
    let marketplace = original.strip_prefix("marketplace+");
    let (trimmed, subdir) = match marketplace {
        Some(value) => {
            let (repo, path) = value.split_once('#').unwrap_or((value, ""));
            if !is_remote_source(repo)
                || path
                    .split('/')
                    .any(|part| part == ".." || part.starts_with('.'))
            {
                return Err(PluginError::BadRequest("Invalid marketplace source".into()));
            }
            (repo, path)
        }
        None => (original, ""),
    };
    if trimmed.is_empty() {
        return Err(PluginError::BadRequest("Plugin source is required".into()));
    }
    if let Some(commit_pin) = commit {
        validate_commit_pin(commit_pin)?;
    }
    if let Some(tag_pin) = tag {
        validate_tag_pin(tag_pin)?;
    }
    let remote = is_remote_source(trimmed);
    if remote
        && commit.is_none()
        && tag.is_none()
        && !(marketplace.is_some() && allow_marketplace_head)
    {
        return Err(PluginError::BadRequest(
            "Remote plugin source requires a commit or tag pin".into(),
        ));
    }

    let staging = TempDir::new()?;
    let dest = staging.path().join("pkg");

    if remote || commit.is_some() || tag.is_some() {
        if !remote && !Path::new(trimmed).is_dir() {
            return Err(PluginError::BadRequest(format!(
                "Plugin source directory does not exist: {trimmed}"
            )));
        }
        let clone_out = Command::new("git")
            .args([
                "-c",
                "core.hooksPath=/dev/null",
                "clone",
                "--no-checkout",
                trimmed,
            ])
            .arg(&dest)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()?;
        if !clone_out.status.success() {
            return Err(PluginError::BadRequest(format!(
                "Failed to clone plugin source: {}",
                String::from_utf8_lossy(&clone_out.stderr).trim()
            )));
        }
        let target_ref = tag
            .map(|tag_name| format!("refs/tags/{tag_name}"))
            .or_else(|| commit.map(str::to_owned))
            .or_else(|| marketplace.map(|_| "HEAD".to_owned()))
            .ok_or_else(|| PluginError::BadRequest("Missing commit or tag pin".into()))?;
        let checkout_out = Command::new("git")
            .arg("-C")
            .arg(&dest)
            .args([
                "-c",
                "core.hooksPath=/dev/null",
                "checkout",
                "--detach",
                &target_ref,
            ])
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()?;
        if !checkout_out.status.success() {
            return Err(PluginError::BadRequest(format!(
                "Failed to checkout pin {target_ref}: {}",
                String::from_utf8_lossy(&checkout_out.stderr).trim()
            )));
        }
        let rev_out = Command::new("git")
            .arg("-C")
            .arg(&dest)
            .args(["rev-parse", "HEAD"])
            .output()?;
        if !rev_out.status.success() {
            return Err(PluginError::BadRequest("Failed to resolve git HEAD".into()));
        }
        let resolved_sha = String::from_utf8_lossy(&rev_out.stdout).trim().to_string();
        if let Some(expected) = commit
            && !resolved_sha
                .to_ascii_lowercase()
                .starts_with(&expected.to_ascii_lowercase())
        {
            return Err(PluginError::BadRequest(format!(
                "Pinned commit {expected} does not match resolved {resolved_sha}"
            )));
        }
        let _ = fs::remove_dir_all(dest.join(".git"));
        let root = fs::canonicalize(dest.join(subdir))?;
        if !root.starts_with(fs::canonicalize(&dest)?) || !root.is_dir() {
            return Err(PluginError::BadRequest(
                "Invalid marketplace directory".into(),
            ));
        }
        Ok((staging, root, Some(resolved_sha), tag.map(str::to_owned)))
    } else {
        let source_path = Path::new(trimmed);
        if !source_path.is_dir() {
            return Err(PluginError::BadRequest(format!(
                "Plugin source directory does not exist: {trimmed}"
            )));
        }
        copy_dir_filtered(source_path, &dest)?;
        Ok((staging, dest, None, None))
    }
}

pub fn compute_dir_hash(dir: &Path) -> Result<String, PluginError> {
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(dir).sort_by_file_name() {
        let entry = entry.map_err(|err| std::io::Error::other(err.to_string()))?;
        if entry.file_type().is_file() {
            let rel = entry
                .path()
                .strip_prefix(dir)
                .map_err(|err| std::io::Error::other(err.to_string()))?;
            files.push((
                rel.to_string_lossy().replace('\\', "/"),
                entry.path().to_path_buf(),
            ));
        }
    }
    files.sort_by(|left, right| left.0.cmp(&right.0));
    let mut hasher = Sha256::new();
    for (rel, path) in files {
        hasher.update(rel.as_bytes());
        hasher.update([0u8]);
        let bytes = fs::read(&path)?;
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(&bytes);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn resolve_rel_path(root: &Path, rel: &str) -> Result<PathBuf, PluginError> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(PluginError::BadRequest(format!(
            "Manifest path must be relative: {rel}"
        )));
    }
    let mut clean = PathBuf::new();
    for comp in rel_path.components() {
        match comp {
            Component::CurDir => {}
            Component::Normal(part) => clean.push(part),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(PluginError::BadRequest(format!(
                    "Invalid relative path in manifest: {rel}"
                )));
            }
        }
    }
    Ok(root.join(clean))
}

fn extract_placeholder(
    raw: &str,
    allow_bearer: bool,
    allow_bare_ref: bool,
) -> Result<String, PluginError> {
    let trimmed = raw.trim();
    let candidate = if allow_bearer {
        trimmed
            .strip_prefix("Bearer ")
            .or_else(|| trimmed.strip_prefix("bearer "))
            .map(str::trim)
            .unwrap_or(trimmed)
    } else {
        trimmed
    };
    if let Some(inner) = candidate
        .strip_prefix("${")
        .and_then(|rest| rest.strip_suffix('}'))
    {
        let inner = inner
            .strip_prefix("env:")
            .or_else(|| inner.strip_prefix("user_config."))
            .unwrap_or(inner);
        if valid_name(inner) {
            return Ok(inner.to_string());
        }
        return Err(PluginError::BadRequest(format!(
            "Invalid secret placeholder: {raw}"
        )));
    }
    if let Some(inner) = candidate
        .strip_prefix("{env:")
        .and_then(|rest| rest.strip_suffix('}'))
    {
        if valid_name(inner) {
            return Ok(inner.to_string());
        }
        return Err(PluginError::BadRequest(format!(
            "Invalid secret placeholder: {raw}"
        )));
    }
    if allow_bare_ref && valid_name(candidate) {
        return Ok(candidate.to_string());
    }
    Err(PluginError::BadRequest(format!(
        "Manifest must use secret placeholders (${{VAR}} or {{env:VAR}}), got: {raw}"
    )))
}

fn is_sensitive_key_or_value(key: &str, raw: &str) -> bool {
    let lower_key = key.to_ascii_lowercase();
    if [
        "authorization",
        "token",
        "secret",
        "password",
        "api_key",
        "apikey",
        "credential",
        "private_key",
        "cookie",
    ]
    .iter()
    .any(|kw| lower_key.contains(kw))
    {
        return true;
    }
    let trimmed = raw.trim();
    let lower_val = trimmed.to_ascii_lowercase();
    lower_val.starts_with("bearer ")
        || lower_val.starts_with("basic ")
        || trimmed.starts_with("sk-")
        || trimmed.starts_with("ghp_")
        || trimmed.starts_with("gho_")
        || trimmed.starts_with("xoxb-")
        || trimmed.starts_with("AIza")
}

fn literal_ref_name(key: &str) -> String {
    let sanitized: String = key
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "literal_value".into()
    } else {
        format!("literal_{sanitized}")
    }
}

fn resolve_manifest_value(
    key: &str,
    raw: &str,
    allow_bearer: bool,
    allow_bare_ref: bool,
) -> Result<(String, Option<String>), PluginError> {
    match extract_placeholder(raw, allow_bearer, allow_bare_ref) {
        Ok(reference) => Ok((reference, None)),
        Err(err) => {
            if !is_sensitive_key_or_value(key, raw) && !raw.trim().is_empty() {
                Ok((literal_ref_name(key), Some(raw.to_owned())))
            } else {
                Err(err)
            }
        }
    }
}

fn validate_mcp_entry(entry: &PluginMcpEntry) -> Result<(), PluginError> {
    if entry.name == "hivedeck" || !valid_name(&entry.name) {
        return Err(PluginError::BadRequest(format!(
            "Invalid MCP server name: {}",
            entry.name
        )));
    }
    validate_roles(&entry.roles)?;
    for reference in entry.headers.values().chain(entry.env.values()) {
        if !valid_name(reference) {
            return Err(PluginError::BadRequest(format!(
                "Invalid secret reference: {reference}"
            )));
        }
    }
    match entry.transport.as_str() {
        "stdio" => {
            if !entry
                .command
                .as_ref()
                .is_some_and(|command| !command.trim().is_empty())
                || entry.url.is_some()
                || !entry.headers.is_empty()
            {
                return Err(PluginError::BadRequest(format!(
                    "Invalid stdio MCP fields for {}",
                    entry.name
                )));
            }
            for item in entry.command.iter().chain(entry.args.iter()) {
                if item.contains("${") {
                    let allowed = item.contains("${CLAUDE_PLUGIN_ROOT}")
                        || item.contains("${HIVEDECK_PLUGIN_ROOT}");
                    if !allowed {
                        return Err(PluginError::BadRequest(format!(
                            "Unsupported command/arg variable in {}: {item}",
                            entry.name
                        )));
                    }
                }
            }
        }
        "http" => {
            let valid_url = entry
                .url
                .as_ref()
                .and_then(|url| reqwest::Url::parse(url).ok())
                .is_some_and(|url| {
                    matches!(url.scheme(), "http" | "https")
                        && url.host().is_some()
                        && url.username().is_empty()
                        && url.password().is_none()
                });
            if entry.command.is_some()
                || !entry.args.is_empty()
                || !entry.env.is_empty()
                || !valid_url
            {
                return Err(PluginError::BadRequest(format!(
                    "Invalid http MCP fields for {}",
                    entry.name
                )));
            }
        }
        other => {
            return Err(PluginError::BadRequest(format!(
                "Unsupported MCP transport {other} for {}",
                entry.name
            )));
        }
    }
    Ok(())
}

fn parse_mcp_servers_map(
    obj: &serde_json::Map<String, Value>,
    default_roles: &[String],
    default_boards: &[String],
    literal_secrets: &mut BTreeMap<String, BTreeMap<String, String>>,
) -> Result<Vec<PluginMcpEntry>, PluginError> {
    let mut entries = Vec::new();
    for (name, value) in obj {
        let server = value.as_object().ok_or_else(|| {
            PluginError::BadRequest(format!("Invalid MCP server definition for {name}"))
        })?;
        let url = server.get("url").and_then(Value::as_str).map(str::to_owned);
        let command = server
            .get("command")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let transport = match server.get("type").and_then(Value::as_str) {
            Some("http") => "http".to_string(),
            Some("stdio") => "stdio".to_string(),
            Some(other) => {
                return Err(PluginError::BadRequest(format!(
                    "Unsupported MCP transport {other} for {name}"
                )));
            }
            None if url.is_some() => "http".to_string(),
            None => "stdio".to_string(),
        };
        let args: Vec<String> = serde_json::from_value(
            server
                .get("args")
                .cloned()
                .unwrap_or_else(|| Value::Array(vec![])),
        )
        .map_err(|_| PluginError::BadRequest(format!("Invalid args for MCP {name}")))?;
        let roles: Vec<String> = match server.get("roles") {
            Some(val) => serde_json::from_value(val.clone())
                .map_err(|_| PluginError::BadRequest(format!("Invalid roles for MCP {name}")))?,
            None => default_roles.to_vec(),
        };
        let boards: Vec<String> = match server.get("boards") {
            Some(val) => serde_json::from_value(val.clone())
                .map_err(|_| PluginError::BadRequest(format!("Invalid boards for MCP {name}")))?,
            None => default_boards.to_vec(),
        };
        let oauth = server
            .get("oauth")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let mut headers = BTreeMap::new();
        if let Some(raw_headers) = server.get("headers") {
            let map = raw_headers.as_object().ok_or_else(|| {
                PluginError::BadRequest(format!("Invalid headers for MCP {name}"))
            })?;
            for (key, val) in map {
                let raw = val.as_str().ok_or_else(|| {
                    PluginError::BadRequest(format!("Header {key} in MCP {name} must be string"))
                })?;
                let (reference, literal) = resolve_manifest_value(key, raw, true, false)?;
                if let Some(literal_val) = literal {
                    literal_secrets
                        .entry(name.clone())
                        .or_default()
                        .insert(reference.clone(), literal_val);
                }
                headers.insert(key.clone(), reference);
            }
        }
        let mut env = BTreeMap::new();
        if let Some(raw_env) = server.get("env") {
            let map = raw_env
                .as_object()
                .ok_or_else(|| PluginError::BadRequest(format!("Invalid env for MCP {name}")))?;
            for (key, val) in map {
                let raw = val.as_str().ok_or_else(|| {
                    PluginError::BadRequest(format!("Env {key} in MCP {name} must be string"))
                })?;
                let (reference, literal) = resolve_manifest_value(key, raw, false, false)?;
                if let Some(literal_val) = literal {
                    literal_secrets
                        .entry(name.clone())
                        .or_default()
                        .insert(reference.clone(), literal_val);
                }
                env.insert(key.clone(), reference);
            }
        }
        let entry = PluginMcpEntry {
            name: name.clone(),
            transport,
            command,
            args,
            url,
            headers,
            env,
            roles,
            boards,
            oauth,
            enabled: true,
            tool_policies: BTreeMap::new(),
            instructions: server
                .get("instructions")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned),
            server_instructions: None,
        };
        validate_mcp_entry(&entry)?;
        entries.push(entry);
    }
    Ok(entries)
}

fn front_matter_name(text: &str) -> Option<String> {
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return None;
    }
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if let Some(value) = line.strip_prefix("name:") {
            let cleaned = value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
            if !cleaned.is_empty() {
                return Some(cleaned);
            }
        }
    }
    None
}

fn load_skill_from_path(
    root: &Path,
    skill_path: &Path,
    roles: Vec<String>,
    boards: Vec<String>,
    clis: Vec<String>,
) -> Result<PluginSkillEntry, PluginError> {
    let skill_md = if skill_path.is_dir() {
        skill_path.join("SKILL.md")
    } else {
        skill_path.to_path_buf()
    };
    if skill_md.file_name().and_then(|name| name.to_str()) != Some("SKILL.md")
        || !skill_md.is_file()
    {
        return Err(PluginError::BadRequest(format!(
            "Skill path missing SKILL.md: {}",
            skill_path.display()
        )));
    }
    let content = fs::read_to_string(&skill_md).map_err(|_| {
        PluginError::BadRequest(format!("Unreadable SKILL.md: {}", skill_md.display()))
    })?;
    let folder_name = skill_md
        .parent()
        .and_then(|parent| parent.file_name())
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let name = front_matter_name(&content).unwrap_or(folder_name);
    if !valid_name(&name) {
        return Err(PluginError::BadRequest(format!(
            "Invalid skill name: {name}"
        )));
    }
    validate_roles(&roles)?;
    validate_clis(&clis)?;
    let rel = skill_md
        .strip_prefix(root)
        .map_err(|_| PluginError::BadRequest("Skill escapes plugin directory".into()))?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(PluginSkillEntry {
        name,
        path: rel,
        roles,
        boards,
        clis,
        enabled: true,
    })
}

fn scan_skills_dir(
    root: &Path,
    skills_dir: &Path,
    roles: &[String],
    boards: &[String],
    clis: &[String],
) -> Result<Vec<PluginSkillEntry>, PluginError> {
    let mut skills = Vec::new();
    if skills_dir.join("SKILL.md").is_file() {
        skills.push(load_skill_from_path(
            root,
            &skills_dir.join("SKILL.md"),
            roles.to_vec(),
            boards.to_vec(),
            clis.to_vec(),
        )?);
        return Ok(skills);
    }
    if !skills_dir.is_dir() {
        return Err(PluginError::BadRequest(format!(
            "Skills directory does not exist: {}",
            skills_dir.display()
        )));
    }
    let mut children: Vec<PathBuf> = fs::read_dir(skills_dir)?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    children.sort();
    for child in children {
        if child.join("SKILL.md").is_file() {
            skills.push(load_skill_from_path(
                root,
                &child.join("SKILL.md"),
                roles.to_vec(),
                boards.to_vec(),
                clis.to_vec(),
            )?);
        }
    }
    Ok(skills)
}

struct ParsedManifest {
    name: String,
    version: String,
    mcp: Vec<PluginMcpEntry>,
    skills: Vec<PluginSkillEntry>,
    unsupported: Vec<String>,
    literal_secrets: BTreeMap<String, BTreeMap<String, String>>,
}

fn marketplace_fallback_version(source: &str, commit: Option<&str>) -> Option<String> {
    source
        .trim()
        .starts_with("marketplace+")
        .then(|| commit.map(|sha| sha.chars().take(12).collect()))
        .flatten()
}

fn parse_manifest(
    root: &Path,
    expected_version: Option<&str>,
    fallback_version: Option<&str>,
    default_roles: &[String],
    default_boards: &[String],
    default_skill_clis: &[String],
) -> Result<ParsedManifest, PluginError> {
    let manifest_path = if root.join(".claude-plugin/plugin.json").is_file() {
        root.join(".claude-plugin/plugin.json")
    } else if root.join("plugin.json").is_file() {
        root.join("plugin.json")
    } else {
        return Err(PluginError::BadRequest(
            "Missing plugin manifest (.claude-plugin/plugin.json or plugin.json)".into(),
        ));
    };

    let bytes = fs::read(&manifest_path)?;
    let manifest: Value = serde_json::from_slice(&bytes)
        .map_err(|_| PluginError::BadRequest("Invalid plugin manifest JSON".into()))?;
    let obj = manifest
        .as_object()
        .ok_or_else(|| PluginError::BadRequest("Plugin manifest must be a JSON object".into()))?;

    let name = obj
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .ok_or_else(|| PluginError::BadRequest("Manifest missing required 'name'".into()))?;
    if name == "hivedeck" || !valid_name(name) {
        return Err(PluginError::BadRequest(format!(
            "Invalid plugin name: {name}"
        )));
    }

    let version = obj
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|val| {
            !val.is_empty() && !val.chars().any(|ch| ch.is_control() || ch.is_whitespace())
        })
        .or(fallback_version)
        .ok_or_else(|| PluginError::BadRequest("Manifest missing required 'version'".into()))?;
    if let Some(pinned) = expected_version
        && version != pinned.trim()
    {
        return Err(PluginError::BadRequest(format!(
            "Pinned version {pinned} does not match manifest version {version}"
        )));
    }

    let mut mcp = Vec::new();
    let mut literal_secrets: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    if let Some(raw_mcp) = obj.get("mcp") {
        let arr = raw_mcp
            .as_array()
            .ok_or_else(|| PluginError::BadRequest("Manifest 'mcp' must be an array".into()))?;
        for item in arr {
            let mut entry: PluginMcpEntry =
                serde_json::from_value(item.clone()).map_err(|err| {
                    PluginError::BadRequest(format!("Invalid manifest mcp entry: {err}"))
                })?;
            for (key, value) in entry.headers.iter_mut() {
                let (reference, literal) = resolve_manifest_value(key, value, true, true)?;
                if let Some(literal_val) = literal {
                    literal_secrets
                        .entry(entry.name.clone())
                        .or_default()
                        .insert(reference.clone(), literal_val);
                }
                *value = reference;
            }
            for (key, value) in entry.env.iter_mut() {
                let (reference, literal) = resolve_manifest_value(key, value, false, true)?;
                if let Some(literal_val) = literal {
                    literal_secrets
                        .entry(entry.name.clone())
                        .or_default()
                        .insert(reference.clone(), literal_val);
                }
                *value = reference;
            }
            if item.get("roles").is_none() {
                entry.roles = default_roles.to_vec();
            }
            if item.get("boards").is_none() && !default_boards.is_empty() {
                entry.boards = default_boards.to_vec();
            }
            validate_mcp_entry(&entry)?;
            mcp.push(entry);
        }
    } else if let Some(raw_servers) = obj.get("mcpServers") {
        if let Some(rel) = raw_servers.as_str() {
            let path = resolve_rel_path(root, rel)?;
            let doc: Value =
                serde_json::from_slice(&fs::read(&path).map_err(|_| {
                    PluginError::BadRequest(format!("Missing MCP config file: {rel}"))
                })?)
                .map_err(|_| PluginError::BadRequest(format!("Invalid MCP JSON: {rel}")))?;
            let map = doc
                .get("mcpServers")
                .and_then(Value::as_object)
                .or_else(|| doc.as_object())
                .ok_or_else(|| PluginError::BadRequest("Invalid MCP servers object".into()))?;
            mcp = parse_mcp_servers_map(map, default_roles, default_boards, &mut literal_secrets)?;
        } else if let Some(map) = raw_servers.as_object() {
            mcp = parse_mcp_servers_map(map, default_roles, default_boards, &mut literal_secrets)?;
        } else {
            return Err(PluginError::BadRequest(
                "Invalid manifest 'mcpServers'".into(),
            ));
        }
    } else if root.join(".mcp.json").is_file() {
        let doc: Value = serde_json::from_slice(&fs::read(root.join(".mcp.json"))?)
            .map_err(|_| PluginError::BadRequest("Invalid .mcp.json".into()))?;
        let map = doc
            .get("mcpServers")
            .and_then(Value::as_object)
            .or_else(|| doc.as_object())
            .ok_or_else(|| PluginError::BadRequest("Invalid .mcp.json object".into()))?;
        mcp = parse_mcp_servers_map(map, default_roles, default_boards, &mut literal_secrets)?;
    }

    let mut skills = Vec::new();
    if let Some(raw_skills) = obj.get("skills") {
        match raw_skills {
            Value::String(rel) => {
                let target = resolve_rel_path(root, rel)?;
                skills = scan_skills_dir(
                    root,
                    &target,
                    default_roles,
                    default_boards,
                    default_skill_clis,
                )?;
            }
            Value::Array(items) => {
                for item in items {
                    if let Some(rel) = item.as_str() {
                        let target = resolve_rel_path(root, rel)?;
                        if target.is_dir() && !target.join("SKILL.md").is_file() {
                            skills.extend(scan_skills_dir(
                                root,
                                &target,
                                default_roles,
                                default_boards,
                                default_skill_clis,
                            )?);
                        } else {
                            skills.push(load_skill_from_path(
                                root,
                                &target,
                                default_roles.to_vec(),
                                default_boards.to_vec(),
                                default_skill_clis.to_vec(),
                            )?);
                        }
                    } else if let Some(skill_obj) = item.as_object() {
                        let rel =
                            skill_obj
                                .get("path")
                                .and_then(Value::as_str)
                                .ok_or_else(|| {
                                    PluginError::BadRequest("Skill entry missing 'path'".into())
                                })?;
                        let target = resolve_rel_path(root, rel)?;
                        let roles = match skill_obj.get("roles") {
                            Some(val) => serde_json::from_value(val.clone()).map_err(|_| {
                                PluginError::BadRequest("Invalid skill roles".into())
                            })?,
                            None => default_roles.to_vec(),
                        };
                        let boards = match skill_obj.get("boards") {
                            Some(val) => serde_json::from_value(val.clone()).map_err(|_| {
                                PluginError::BadRequest("Invalid skill boards".into())
                            })?,
                            None => default_boards.to_vec(),
                        };
                        let clis = match skill_obj.get("clis") {
                            Some(val) => serde_json::from_value(val.clone()).map_err(|_| {
                                PluginError::BadRequest("Invalid skill clis".into())
                            })?,
                            None => default_skill_clis.to_vec(),
                        };
                        let mut entry = load_skill_from_path(root, &target, roles, boards, clis)?;
                        if let Some(explicit_name) = skill_obj.get("name").and_then(Value::as_str) {
                            if !valid_name(explicit_name) {
                                return Err(PluginError::BadRequest(format!(
                                    "Invalid skill name: {explicit_name}"
                                )));
                            }
                            entry.name = explicit_name.to_string();
                        }
                        skills.push(entry);
                    } else {
                        return Err(PluginError::BadRequest(
                            "Invalid skill manifest item".into(),
                        ));
                    }
                }
            }
            _ => return Err(PluginError::BadRequest("Invalid manifest 'skills'".into())),
        }
    } else if root.join("skills").is_dir() {
        skills = scan_skills_dir(
            root,
            &root.join("skills"),
            default_roles,
            default_boards,
            default_skill_clis,
        )?;
    }

    let mut unsupported = BTreeSet::new();
    for key in [
        "hooks",
        "agents",
        "commands",
        "lspServers",
        "outputStyles",
        "userConfig",
        "channels",
    ] {
        if obj.contains_key(key) {
            unsupported.insert(key.to_string());
        }
    }
    if root.join("hooks").is_dir() || root.join("hooks.json").is_file() {
        unsupported.insert("hooks".to_string());
    }
    if root.join("agents").is_dir() {
        unsupported.insert("agents".to_string());
    }
    if root.join("commands").is_dir() {
        unsupported.insert("commands".to_string());
    }
    if root.join(".lsp.json").is_file() {
        unsupported.insert("lspServers".to_string());
    }

    let mut seen_mcp = BTreeSet::new();
    for item in &mcp {
        if !seen_mcp.insert(&item.name) {
            return Err(PluginError::BadRequest(format!(
                "Duplicate MCP server name in plugin: {}",
                item.name
            )));
        }
    }
    let mut seen_skills = BTreeSet::new();
    for item in &skills {
        if !seen_skills.insert(&item.name) {
            return Err(PluginError::BadRequest(format!(
                "Duplicate skill name in plugin: {}",
                item.name
            )));
        }
    }

    Ok(ParsedManifest {
        name: name.to_string(),
        version: version.to_string(),
        mcp,
        skills,
        unsupported: unsupported.into_iter().collect(),
        literal_secrets,
    })
}

fn resolve_conflicts(
    candidate_name: &str,
    mcp: &mut [PluginMcpEntry],
    skills: &mut [PluginSkillEntry],
    existing_plugins: &mut [InstalledPlugin],
    mcp_registry_entries: &[RegistryEntry],
    policy: ConflictPolicy,
) -> Result<Vec<PluginConflict>, PluginError> {
    let mut conflicts = Vec::new();

    for entry in mcp.iter_mut() {
        let mut against = Vec::new();
        if mcp_registry_entries
            .iter()
            .any(|reg| reg.name == entry.name)
        {
            against.push("mcp_registry".to_string());
        }
        for other in existing_plugins.iter() {
            if other.name != candidate_name
                && other.enabled
                && other.mcp.iter().any(|m| m.enabled && m.name == entry.name)
            {
                against.push(format!("plugin:{}", other.name));
            }
        }
        for source in against {
            match policy {
                ConflictPolicy::Abort => conflicts.push(PluginConflict {
                    kind: "mcp".into(),
                    name: entry.name.clone(),
                    against: source,
                    action: None,
                }),
                ConflictPolicy::Skip => {
                    entry.enabled = false;
                    conflicts.push(PluginConflict {
                        kind: "mcp".into(),
                        name: entry.name.clone(),
                        against: source,
                        action: Some("skipped".into()),
                    });
                }
                ConflictPolicy::Overwrite => {
                    if let Some(other_name) = source.strip_prefix("plugin:")
                        && let Some(other) =
                            existing_plugins.iter_mut().find(|p| p.name == other_name)
                    {
                        for m in other.mcp.iter_mut().filter(|m| m.name == entry.name) {
                            m.enabled = false;
                        }
                        other.notes.push(PluginConflict {
                            kind: "mcp".into(),
                            name: entry.name.clone(),
                            against: format!("plugin:{candidate_name}"),
                            action: Some("overwritten_by".into()),
                        });
                    }
                    conflicts.push(PluginConflict {
                        kind: "mcp".into(),
                        name: entry.name.clone(),
                        against: source,
                        action: Some("overwritten".into()),
                    });
                }
            }
        }
    }

    for skill in skills.iter_mut() {
        let mut against = Vec::new();
        for other in existing_plugins.iter() {
            if other.name != candidate_name
                && other.enabled
                && other
                    .skills
                    .iter()
                    .any(|s| s.enabled && s.name == skill.name)
            {
                against.push(format!("plugin:{}", other.name));
            }
        }
        for source in against {
            match policy {
                ConflictPolicy::Abort => conflicts.push(PluginConflict {
                    kind: "skill".into(),
                    name: skill.name.clone(),
                    against: source,
                    action: None,
                }),
                ConflictPolicy::Skip => {
                    skill.enabled = false;
                    conflicts.push(PluginConflict {
                        kind: "skill".into(),
                        name: skill.name.clone(),
                        against: source,
                        action: Some("skipped".into()),
                    });
                }
                ConflictPolicy::Overwrite => {
                    if let Some(other_name) = source.strip_prefix("plugin:")
                        && let Some(other) =
                            existing_plugins.iter_mut().find(|p| p.name == other_name)
                    {
                        for s in other.skills.iter_mut().filter(|s| s.name == skill.name) {
                            s.enabled = false;
                        }
                        other.notes.push(PluginConflict {
                            kind: "skill".into(),
                            name: skill.name.clone(),
                            against: format!("plugin:{candidate_name}"),
                            action: Some("overwritten_by".into()),
                        });
                    }
                    conflicts.push(PluginConflict {
                        kind: "skill".into(),
                        name: skill.name.clone(),
                        against: source,
                        action: Some("overwritten".into()),
                    });
                }
            }
        }
    }

    if policy == ConflictPolicy::Abort && !conflicts.is_empty() {
        return Err(PluginError::Conflict(conflicts));
    }
    Ok(conflicts)
}

pub fn install_plugin(
    dir: &Path,
    req: InstallPluginRequest,
) -> Result<InstalledPlugin, PluginError> {
    if let Some(entry) = req.single_mcp.clone() {
        let mut plugin = single_mcp_plugin(entry, &req)?;
        let _lock = WRITE_LOCK
            .lock()
            .map_err(|_| std::io::Error::other("Plugin registry lock poisoned"))?;
        let mut plugins = read_plugins(dir)?;
        if plugins.iter().any(|item| item.name == plugin.name) {
            return Err(PluginError::ConflictMessage(format!(
                "Plugin '{}' is already installed",
                plugin.name
            )));
        }
        let registry: Vec<RegistryEntry> = read_json_or_default(&dir.join("mcp_registry.json"))?;
        plugin.notes = resolve_conflicts(
            &plugin.name,
            &mut plugin.mcp,
            &mut [],
            &mut plugins,
            &registry,
            req.conflict_policy,
        )?;
        for (server, refs) in &req.secrets {
            if server != &plugin.name
                || refs.keys().any(|reference| {
                    !plugin.mcp[0]
                        .headers
                        .values()
                        .chain(plugin.mcp[0].env.values())
                        .any(|item| item == reference)
                })
            {
                return Err(PluginError::BadRequest(
                    "Unknown MCP secret reference".into(),
                ));
            }
        }
        let mut secrets = read_plugin_secrets(dir)?;
        if !req.secrets.is_empty() {
            secrets.insert(plugin.name.clone(), req.secrets);
            write_atomic(&secrets_path(dir), &secrets, true)?;
        }
        plugins.push(plugin.clone());
        write_atomic(&plugins_path(dir), &plugins, false)?;
        return Ok(plugin);
    }
    let default_roles = req.roles.unwrap_or_else(default_roles);
    let default_boards = req.boards.unwrap_or_default();
    let default_skill_clis = req.skill_clis.unwrap_or_default();
    validate_roles(&default_roles)?;
    validate_clis(&default_skill_clis)?;

    let (_staging, staged_root, resolved_commit, resolved_tag) = stage_source(
        &req.source,
        req.commit.as_deref(),
        req.tag.as_deref(),
        false,
    )?;
    let mut parsed = parse_manifest(
        &staged_root,
        req.version.as_deref(),
        marketplace_fallback_version(&req.source, resolved_commit.as_deref()).as_deref(),
        &default_roles,
        &default_boards,
        &default_skill_clis,
    )?;
    let asset_hash = compute_dir_hash(&staged_root)?;

    for (mcp_name, refs) in &req.secrets {
        let mcp_entry = parsed
            .mcp
            .iter()
            .find(|m| m.name == *mcp_name)
            .ok_or_else(|| {
                PluginError::BadRequest(format!("Unknown MCP in secrets: {mcp_name}"))
            })?;
        for secret_ref in refs.keys() {
            let declared = mcp_entry
                .headers
                .values()
                .chain(mcp_entry.env.values())
                .any(|val| val == secret_ref);
            if !declared {
                return Err(PluginError::BadRequest(format!(
                    "Secret {secret_ref} not declared by MCP {mcp_name}"
                )));
            }
        }
    }

    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Plugin registry lock poisoned"))?;
    let mut plugins = read_plugins(dir)?;
    if plugins.iter().any(|p| p.name == parsed.name) {
        return Err(PluginError::ConflictMessage(format!(
            "Plugin '{}' is already installed",
            parsed.name
        )));
    }
    let mcp_registry: Vec<RegistryEntry> = read_json_or_default(&dir.join("mcp_registry.json"))?;
    let notes = resolve_conflicts(
        &parsed.name,
        &mut parsed.mcp,
        &mut parsed.skills,
        &mut plugins,
        &mcp_registry,
        req.conflict_policy,
    )?;

    let target_dir = plugin_asset_dir(dir, &parsed.name);
    if target_dir.exists() {
        fs::remove_dir_all(&target_dir)?;
    }
    copy_dir_filtered(&staged_root, &target_dir)?;

    let installed = InstalledPlugin {
        name: parsed.name.clone(),
        version: parsed.version,
        source: req.source,
        commit: resolved_commit,
        tag: resolved_tag,
        enabled: true,
        asset_hash,
        mcp: parsed.mcp,
        skills: parsed.skills,
        unsupported: parsed.unsupported,
        notes,
    };
    plugins.push(installed.clone());

    let mut merged_secrets = parsed.literal_secrets;
    for (mcp_name, refs) in req.secrets {
        let target = merged_secrets.entry(mcp_name).or_default();
        for (k, v) in refs {
            target.insert(k, v);
        }
    }

    if let Err(err) = (|| -> Result<(), PluginError> {
        if !merged_secrets.is_empty() {
            let mut all_secrets = read_plugin_secrets(dir)?;
            all_secrets.insert(parsed.name.clone(), merged_secrets);
            write_atomic(&secrets_path(dir), &all_secrets, true)?;
        }
        write_atomic(&plugins_path(dir), &plugins, false)?;
        Ok(())
    })() {
        let _ = fs::remove_dir_all(&target_dir);
        return Err(err);
    }

    Ok(installed)
}

pub fn latest_tag(dir: &Path, name: &str) -> Result<Option<String>, PluginError> {
    let plugin = read_plugins(dir)?
        .into_iter()
        .find(|p| p.name == name)
        .ok_or_else(|| PluginError::NotFound(format!("Plugin '{name}' not found")))?;
    if plugin.source == "mcp-single" || !is_remote_source(plugin.source.trim()) {
        return Ok(None);
    }
    let out = Command::new("git")
        .args(["ls-remote", "--tags", "--refs", "--sort=-v:refname"])
        .arg(plugin.source.trim())
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()?;
    if !out.status.success() {
        return Err(PluginError::BadRequest(format!(
            "Failed to list tags: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .find_map(|line| {
            line.split_once("refs/tags/")
                .map(|(_, tag)| tag.to_string())
        }))
}

pub fn preview_plugin(req: InstallPluginRequest) -> Result<InstalledPlugin, PluginError> {
    if let Some(entry) = req.single_mcp.clone() {
        return single_mcp_plugin(entry, &req);
    }
    let roles = req.roles.unwrap_or_else(default_roles);
    let boards = req.boards.unwrap_or_default();
    let skill_clis = req.skill_clis.unwrap_or_default();
    validate_roles(&roles)?;
    validate_clis(&skill_clis)?;
    let (_staging, staged_root, commit, tag) =
        stage_source(&req.source, req.commit.as_deref(), req.tag.as_deref(), true)?;
    let parsed = parse_manifest(
        &staged_root,
        req.version.as_deref(),
        marketplace_fallback_version(&req.source, commit.as_deref()).as_deref(),
        &roles,
        &boards,
        &skill_clis,
    )?;
    Ok(InstalledPlugin {
        name: parsed.name,
        version: parsed.version,
        source: req.source,
        commit,
        tag,
        enabled: true,
        asset_hash: compute_dir_hash(&staged_root)?,
        mcp: parsed.mcp,
        skills: parsed.skills,
        unsupported: parsed.unsupported,
        notes: Vec::new(),
    })
}

fn single_mcp_plugin(
    entry: PluginMcpEntry,
    req: &InstallPluginRequest,
) -> Result<InstalledPlugin, PluginError> {
    validate_mcp_entry(&entry)?;
    if req.tag.is_some() || req.commit.is_some() {
        return Err(PluginError::BadRequest(
            "MCP servers cannot be pinned".into(),
        ));
    }
    Ok(InstalledPlugin {
        name: entry.name.clone(),
        version: "1".into(),
        source: "mcp-single".into(),
        commit: None,
        tag: None,
        enabled: true,
        asset_hash: String::new(),
        mcp: vec![entry],
        skills: vec![],
        unsupported: vec![],
        notes: vec![],
    })
}

pub fn upgrade_plugin(
    dir: &Path,
    name: &str,
    req: UpgradePluginRequest,
) -> Result<InstalledPlugin, PluginError> {
    if !valid_name(name) {
        return Err(PluginError::BadRequest("Invalid plugin name".into()));
    }
    let snapshot_source = {
        let _lock = WRITE_LOCK
            .lock()
            .map_err(|_| std::io::Error::other("Plugin registry lock poisoned"))?;
        let plugins = read_plugins(dir)?;
        plugins
            .into_iter()
            .find(|p| p.name == name)
            .ok_or_else(|| PluginError::NotFound(format!("Plugin '{name}' not found")))?
    };

    if snapshot_source.source == "mcp-single" {
        return Err(PluginError::BadRequest(
            "Single MCP servers cannot be upgraded".into(),
        ));
    }

    let source = req.source.unwrap_or_else(|| snapshot_source.source.clone());
    let commit = req.commit.or_else(|| {
        if req.tag.is_none() {
            snapshot_source.commit.clone()
        } else {
            None
        }
    });
    let tag = req.tag.or_else(|| {
        if commit.is_none() {
            snapshot_source.tag.clone()
        } else {
            None
        }
    });

    let (_staging, staged_root, resolved_commit, resolved_tag) =
        stage_source(&source, commit.as_deref(), tag.as_deref(), false)?;
    let mut parsed = parse_manifest(
        &staged_root,
        req.version.as_deref(),
        marketplace_fallback_version(&source, resolved_commit.as_deref()).as_deref(),
        &default_roles(),
        &[],
        &[],
    )?;
    if parsed.name != name {
        return Err(PluginError::BadRequest(format!(
            "Upgraded manifest name '{}' does not match '{name}'",
            parsed.name
        )));
    }
    let asset_hash = compute_dir_hash(&staged_root)?;

    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Plugin registry lock poisoned"))?;
    let mut plugins = read_plugins(dir)?;
    let idx = plugins
        .iter()
        .position(|p| p.name == name)
        .ok_or_else(|| PluginError::NotFound(format!("Plugin '{name}' not found")))?;
    let prev = plugins[idx].clone();

    for entry in &mut parsed.mcp {
        if let Some(old) = prev.mcp.iter().find(|m| m.name == entry.name) {
            entry.roles = old.roles.clone();
            entry.boards = old.boards.clone();
            entry.enabled = old.enabled;
        }
    }
    for skill in &mut parsed.skills {
        if let Some(old) = prev.skills.iter().find(|s| s.name == skill.name) {
            skill.roles = old.roles.clone();
            skill.boards = old.boards.clone();
            skill.clis = old.clis.clone();
            skill.enabled = old.enabled;
        }
    }

    let mcp_registry: Vec<RegistryEntry> = read_json_or_default(&dir.join("mcp_registry.json"))?;
    let notes = resolve_conflicts(
        name,
        &mut parsed.mcp,
        &mut parsed.skills,
        &mut plugins,
        &mcp_registry,
        req.conflict_policy,
    )?;

    let target_dir = plugin_asset_dir(dir, name);
    let backup_dir = dir
        .join("plugins")
        .join(format!(".backup-{name}-{}", Uuid::new_v4()));
    if target_dir.exists() {
        fs::rename(&target_dir, &backup_dir)?;
    }

    if let Err(err) = (|| -> Result<(), PluginError> {
        copy_dir_filtered(&staged_root, &target_dir)?;
        let updated = InstalledPlugin {
            name: name.to_string(),
            version: parsed.version,
            source,
            commit: resolved_commit,
            tag: resolved_tag,
            enabled: prev.enabled,
            asset_hash,
            mcp: parsed.mcp,
            skills: parsed.skills,
            unsupported: parsed.unsupported,
            notes,
        };
        plugins[idx] = updated;
        write_atomic(&plugins_path(dir), &plugins, false)?;
        Ok(())
    })() {
        let _ = fs::remove_dir_all(&target_dir);
        if backup_dir.exists() {
            let _ = fs::rename(&backup_dir, &target_dir);
        }
        return Err(err);
    }

    if backup_dir.exists() {
        let _ = fs::remove_dir_all(&backup_dir);
    }
    Ok(plugins.into_iter().nth(idx).unwrap())
}

pub fn uninstall_plugin(dir: &Path, name: &str) -> Result<(), PluginError> {
    if !valid_name(name) {
        return Err(PluginError::BadRequest("Invalid plugin name".into()));
    }
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Plugin registry lock poisoned"))?;
    let mut plugins = read_plugins(dir)?;
    let before = plugins.len();
    plugins.retain(|p| p.name != name);
    if plugins.len() == before {
        return Err(PluginError::NotFound(format!("Plugin '{name}' not found")));
    }

    write_atomic(&plugins_path(dir), &plugins, false)?;

    let mut secrets = read_plugin_secrets(dir)?;
    if secrets.remove(name).is_some() {
        write_atomic(&secrets_path(dir), &secrets, true)?;
    }

    let _ = crate::mcp_oauth::remove_plugin_oauth_tokens(dir, name);

    let asset = plugin_asset_dir(dir, name);
    if asset.exists() {
        fs::remove_dir_all(asset)?;
    }
    Ok(())
}

pub fn set_plugin_enabled(
    dir: &Path,
    name: &str,
    enabled: bool,
) -> Result<InstalledPlugin, PluginError> {
    if !valid_name(name) {
        return Err(PluginError::BadRequest("Invalid plugin name".into()));
    }
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Plugin registry lock poisoned"))?;
    let mut plugins = read_plugins(dir)?;
    let plugin = plugins
        .iter_mut()
        .find(|p| p.name == name)
        .ok_or_else(|| PluginError::NotFound(format!("Plugin '{name}' not found")))?;
    plugin.enabled = enabled;
    let updated = plugin.clone();
    write_atomic(&plugins_path(dir), &plugins, false)?;
    Ok(updated)
}

pub fn update_skill_scope(
    dir: &Path,
    plugin_name: &str,
    skill_name: &str,
    roles: Option<Vec<String>>,
    boards: Option<Vec<String>>,
    clis: Option<Vec<String>>,
    enabled: Option<bool>,
) -> Result<PluginSkillEntry, PluginError> {
    if !valid_name(plugin_name) || !valid_name(skill_name) {
        return Err(PluginError::BadRequest(
            "Invalid plugin or skill name".into(),
        ));
    }
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Plugin registry lock poisoned"))?;
    let mut plugins = read_plugins(dir)?;
    let plugin = plugins
        .iter_mut()
        .find(|p| p.name == plugin_name)
        .ok_or_else(|| PluginError::NotFound(format!("Plugin '{plugin_name}' not found")))?;
    let skill = plugin
        .skills
        .iter_mut()
        .find(|s| s.name == skill_name)
        .ok_or_else(|| PluginError::NotFound(format!("Skill '{skill_name}' not found")))?;
    if let Some(roles) = roles {
        validate_roles(&roles)?;
        skill.roles = roles;
    }
    if let Some(boards) = boards {
        skill.boards = boards;
    }
    if let Some(clis) = clis {
        validate_clis(&clis)?;
        skill.clis = clis;
    }
    if let Some(enabled) = enabled {
        skill.enabled = enabled;
    }
    let updated = skill.clone();
    write_atomic(&plugins_path(dir), &plugins, false)?;
    Ok(updated)
}

#[allow(clippy::too_many_arguments)]
pub fn update_mcp_scope(
    dir: &Path,
    plugin_name: &str,
    mcp_name: &str,
    roles: Option<Vec<String>>,
    boards: Option<Vec<String>>,
    enabled: Option<bool>,
    tool_policies: Option<BTreeMap<String, McpToolPolicy>>,
    instructions: Option<String>,
) -> Result<PluginMcpEntry, PluginError> {
    if !valid_name(plugin_name) || !valid_name(mcp_name) {
        return Err(PluginError::BadRequest("Invalid plugin or MCP name".into()));
    }
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Plugin registry lock poisoned"))?;
    let mut plugins = read_plugins(dir)?;
    let plugin = plugins
        .iter_mut()
        .find(|p| p.name == plugin_name)
        .ok_or_else(|| PluginError::NotFound(format!("Plugin '{plugin_name}' not found")))?;
    let mcp = plugin
        .mcp
        .iter_mut()
        .find(|m| m.name == mcp_name)
        .ok_or_else(|| PluginError::NotFound(format!("MCP '{mcp_name}' not found")))?;
    if let Some(roles) = roles {
        validate_roles(&roles)?;
        mcp.roles = roles;
    }
    if let Some(boards) = boards {
        mcp.boards = boards;
    }
    if let Some(enabled) = enabled {
        mcp.enabled = enabled;
    }
    if let Some(policies) = tool_policies {
        mcp.tool_policies = policies
            .into_iter()
            .filter(|(_, policy)| *policy != McpToolPolicy::Default)
            .collect();
    }
    if let Some(instructions) = instructions {
        let trimmed = instructions.trim();
        mcp.instructions = (!trimmed.is_empty()).then(|| trimmed.to_string());
    }
    let updated = mcp.clone();
    write_atomic(&plugins_path(dir), &plugins, false)?;
    Ok(updated)
}

pub fn update_mcp_server_instructions(
    dir: &Path,
    plugin_name: &str,
    mcp_name: &str,
    server_instructions: Option<String>,
) -> Result<(), PluginError> {
    if !valid_name(plugin_name) || !valid_name(mcp_name) {
        return Err(PluginError::BadRequest("Invalid plugin or MCP name".into()));
    }
    let normalized = server_instructions
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Plugin registry lock poisoned"))?;
    let mut plugins = read_plugins(dir)?;
    let Some(plugin) = plugins.iter_mut().find(|p| p.name == plugin_name) else {
        return Ok(());
    };
    let Some(mcp) = plugin.mcp.iter_mut().find(|m| m.name == mcp_name) else {
        return Ok(());
    };
    if mcp.server_instructions == normalized {
        return Ok(());
    }
    mcp.server_instructions = normalized;
    write_atomic(&plugins_path(dir), &plugins, false)?;
    Ok(())
}

pub fn claude_tool_policy_args(dir: &Path, injected: &[InjectedMcpServer]) -> Vec<String> {
    if injected.is_empty() {
        return Vec::new();
    }
    let Ok(plugins) = read_plugins(dir) else {
        return Vec::new();
    };
    let active_names: BTreeSet<&str> = injected.iter().map(|s| s.name.as_str()).collect();
    let mut allow = Vec::new();
    let mut block = Vec::new();
    for plugin in plugins.into_iter().filter(|p| p.enabled) {
        for mcp in plugin.mcp.into_iter().filter(|m| m.enabled) {
            if !active_names.contains(mcp.name.as_str()) {
                continue;
            }
            for (tool, policy) in mcp.tool_policies {
                let qualified = format!("mcp__{}__{}", mcp.name, tool);
                match policy {
                    McpToolPolicy::Allow => allow.push(qualified),
                    McpToolPolicy::Block => block.push(qualified),
                    McpToolPolicy::Default | McpToolPolicy::Ask => {}
                }
            }
        }
    }
    let mut args = Vec::new();
    if !allow.is_empty() {
        args.push(format!("--allowedTools={}", allow.join(",")));
    }
    if !block.is_empty() {
        args.push(format!("--disallowedTools={}", block.join(",")));
    }
    args
}

pub fn set_plugin_mcp_secret(
    dir: &Path,
    plugin_name: &str,
    mcp_name: &str,
    secret_name: &str,
    value: Option<String>,
) -> Result<bool, PluginError> {
    if !valid_name(plugin_name) || !valid_name(mcp_name) || !valid_name(secret_name) {
        return Err(PluginError::BadRequest("Invalid secret identifier".into()));
    }
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("Plugin registry lock poisoned"))?;
    let plugins = read_plugins(dir)?;
    let plugin = plugins
        .iter()
        .find(|p| p.name == plugin_name)
        .ok_or_else(|| PluginError::NotFound(format!("Plugin '{plugin_name}' not found")))?;
    let mcp = plugin
        .mcp
        .iter()
        .find(|m| m.name == mcp_name)
        .ok_or_else(|| PluginError::NotFound(format!("MCP '{mcp_name}' not found")))?;
    let declared = mcp
        .headers
        .values()
        .chain(mcp.env.values())
        .any(|val| val == secret_name);
    if value.is_some() && !declared {
        return Err(PluginError::BadRequest(format!(
            "Secret '{secret_name}' is not declared by MCP '{mcp_name}'"
        )));
    }

    let mut secrets = read_plugin_secrets(dir)?;
    let has_value = if let Some(val) = value {
        secrets
            .entry(plugin_name.to_string())
            .or_default()
            .entry(mcp_name.to_string())
            .or_default()
            .insert(secret_name.to_string(), val);
        true
    } else {
        if let Some(plugin_map) = secrets.get_mut(plugin_name) {
            if let Some(mcp_map) = plugin_map.get_mut(mcp_name) {
                mcp_map.remove(secret_name);
                if mcp_map.is_empty() {
                    plugin_map.remove(mcp_name);
                }
            }
            if plugin_map.is_empty() {
                secrets.remove(plugin_name);
            }
        }
        false
    };
    write_atomic(&secrets_path(dir), &secrets, true)?;
    Ok(has_value)
}

fn expand_plugin_root(raw: &str, root: &Path) -> String {
    let root_str = root.to_string_lossy();
    raw.replace("${CLAUDE_PLUGIN_ROOT}", &root_str)
        .replace("${HIVEDECK_PLUGIN_ROOT}", &root_str)
}

fn sanitize_env_part(raw: &str) -> String {
    raw.replace('-', "_").to_ascii_uppercase()
}

#[allow(clippy::too_many_arguments)]
pub fn select_mcp_for_run(
    asset_dir: &Path,
    mcp_entries: Vec<RegistryEntry>,
    mcp_secrets: &BTreeMap<String, String>,
    plugins: &[InstalledPlugin],
    plugin_secrets: &PluginsSecrets,
    cli: &str,
    role: &str,
    board: Option<&str>,
) -> Result<(Vec<InjectedMcpServer>, HashMap<String, String>), String> {
    let mut selected_plugins: Vec<(String, PluginMcpEntry)> = Vec::new();
    let mut overridden_names = BTreeSet::new();
    for plugin in plugins {
        if !plugin.enabled {
            continue;
        }
        for entry in &plugin.mcp {
            if !entry.enabled
                || entry.name == "hivedeck"
                || !entry.roles.iter().any(|item| item == role)
                || (!entry.boards.is_empty()
                    && !board.is_some_and(|board| entry.boards.iter().any(|item| item == board)))
            {
                continue;
            }
            overridden_names.insert(entry.name.clone());
            selected_plugins.push((plugin.name.clone(), entry.clone()));
        }
    }

    let remaining_registry: Vec<RegistryEntry> = mcp_entries
        .into_iter()
        .filter(|entry| !overridden_names.contains(&entry.name))
        .collect();
    let (mut servers, mut variables) =
        mcp_registry::select(remaining_registry, mcp_secrets, cli, role, board)?;

    let oauth_tokens = crate::mcp_oauth::read_oauth_tokens(asset_dir).unwrap_or_default();

    for (plugin_name, entry) in selected_plugins {
        let root = plugin_asset_dir(asset_dir, &plugin_name);
        let server_secrets = plugin_secrets
            .get(&plugin_name)
            .and_then(|by_mcp| by_mcp.get(&entry.name));
        let oauth_token = oauth_tokens
            .get(&plugin_name)
            .and_then(|by_mcp| by_mcp.get(&entry.name));

        let mut resolve_map =
            |values: &BTreeMap<String, String>| -> Result<BTreeMap<String, String>, String> {
                values
                    .iter()
                    .map(|(key, ref_name)| {
                        if !valid_name(ref_name) {
                            return Err("Invalid plugin MCP secret reference".into());
                        }
                        let secret = server_secrets
                            .and_then(|map| map.get(ref_name))
                            .ok_or_else(|| {
                                format!(
                                    "Missing plugin MCP secret: {plugin_name}/{}/{ref_name}",
                                    entry.name
                                )
                            })?;
                        let variable = format!(
                            "HIVEDECK_MCP_PLUGIN_{}_{}_{}_TOKEN",
                            sanitize_env_part(&plugin_name),
                            sanitize_env_part(&entry.name),
                            sanitize_env_part(ref_name),
                        );
                        variables.insert(variable.clone(), secret.clone());
                        Ok((key.clone(), variable))
                    })
                    .collect()
            };

        let mut headers = resolve_map(&entry.headers)?;
        let env = resolve_map(&entry.env)?;
        if (entry.oauth || entry.transport == "http")
            && !headers
                .keys()
                .any(|k| k.eq_ignore_ascii_case("authorization"))
            && let Some(token) = oauth_token
        {
            let variable = format!(
                "HIVEDECK_MCP_PLUGIN_{}_{}_OAUTH_TOKEN",
                sanitize_env_part(&plugin_name),
                sanitize_env_part(&entry.name),
            );
            variables.insert(variable.clone(), token.access_token.clone());
            headers.insert("Authorization".to_string(), variable);
        }
        servers.push(InjectedMcpServer {
            name: entry.name,
            transport: entry.transport,
            command: entry.command.map(|cmd| expand_plugin_root(&cmd, &root)),
            args: entry
                .args
                .into_iter()
                .map(|arg| expand_plugin_root(&arg, &root))
                .collect(),
            url: entry.url,
            headers,
            env,
            instructions: entry.instructions.or(entry.server_instructions),
        });
    }

    Ok((servers, variables))
}

pub fn select_skills_for_run(
    asset_dir: &Path,
    plugins: &[InstalledPlugin],
    cli: &str,
    role: &str,
    board: Option<&str>,
) -> Vec<SelectedSkill> {
    let mut out = Vec::new();
    for plugin in plugins {
        if !plugin.enabled {
            continue;
        }
        let root = plugin_asset_dir(asset_dir, &plugin.name);
        for skill in &plugin.skills {
            if !skill.enabled
                || !skill.roles.iter().any(|item| item == role)
                || (!skill.boards.is_empty()
                    && !board.is_some_and(|board| skill.boards.iter().any(|item| item == board)))
                || (!skill.clis.is_empty() && !skill.clis.iter().any(|item| item == cli))
            {
                continue;
            }
            if let Ok(skill_md) = resolve_rel_path(&root, &skill.path)
                && let Some(skill_dir) = skill_md.parent()
                && skill_md.is_file()
            {
                out.push(SelectedSkill {
                    plugin_name: plugin.name.clone(),
                    name: skill.name.clone(),
                    source_skill_dir: skill_dir.to_path_buf(),
                });
            }
        }
    }
    out
}

pub fn materialize_run_skills(
    asset_dir: &Path,
    run_id: &str,
    cli: &str,
    skills: &[SelectedSkill],
) -> Result<Vec<PathBuf>, PluginError> {
    if skills.is_empty() {
        return Ok(Vec::new());
    }
    let run_root = asset_dir.join("run_skills").join(run_id);
    let (container_root, cli_arg_dir) = match cli {
        "claude_code" => {
            let add_dir = run_root.join("claude");
            (add_dir.join(".claude").join("skills"), Some(add_dir))
        }
        "opencode" => {
            let skills_dir = run_root.join("opencode");
            (skills_dir.clone(), Some(skills_dir))
        }
        "cursor_agent" => {
            let plugin_dir = run_root.join("cursor_plugin");
            (plugin_dir.join("skills"), Some(plugin_dir))
        }
        "gemini" | "qwen_code" | "amp" | "copilot" | "droid" => {
            let skills_dir = run_root.join("skills");
            (skills_dir.clone(), Some(skills_dir))
        }
        _ => (run_root.join("skills"), None),
    };

    if cli == "cursor_agent" {
        let plugin_dir = run_root.join("cursor_plugin");
        let manifest_dir = plugin_dir.join(".cursor-plugin");
        fs::create_dir_all(&manifest_dir)?;
        fs::write(
            manifest_dir.join("plugin.json"),
            json!({"name": "hivedeck-run"}).to_string(),
        )?;
    }

    for skill in skills {
        let dst = container_root.join(&skill.name);
        if dst.exists() {
            fs::remove_dir_all(&dst)?;
        }
        copy_dir_filtered(&skill.source_skill_dir, &dst)?;
    }

    if let Some(path) = cli_arg_dir {
        Ok(vec![path])
    } else {
        tracing::debug!(
            cli,
            count = skills.len(),
            "CLI does not support per-run skill directory flags; materialized into run_skills without CLI flag"
        );
        Ok(Vec::new())
    }
}

pub fn cleanup_run_skills(asset_dir: &Path, run_id: &str) {
    let run_root = asset_dir.join("run_skills").join(run_id);
    if run_root.exists() {
        let _ = fs::remove_dir_all(run_root);
    }
}

/// Per-run settings file for Gemini CLI / Qwen Code, inside the run's
/// `run_skills/<run_id>` dir (removed by [`cleanup_run_skills`]). Holds env
/// placeholders only, never secret values. Returns the file path.
pub fn write_droid_settings(
    asset_dir: &Path,
    run_id: &str,
    servers: &[InjectedMcpServer],
) -> Result<PathBuf, PluginError> {
    let run_root = asset_dir.join("run_skills").join(run_id);
    fs::create_dir_all(&run_root)?;
    let path = run_root.join("droid_settings.json");
    fs::write(&path, mcp_registry::droid_settings(servers, None))?;
    Ok(path)
}

/// Per-run `--plugin-dir` bundle for Cursor Agent (`run_skills/<run_id>/cursor_plugin`).
/// Combines `.cursor-plugin/plugin.json`, `.mcp.json` (with `${VAR}` placeholders),
/// and `skills/<name>/SKILL.md`. Returns `None` when both inputs are empty.
pub fn write_cursor_plugin_dir(
    asset_dir: &Path,
    run_id: &str,
    servers: &[InjectedMcpServer],
    skills: &[SelectedSkill],
) -> Result<Option<PathBuf>, PluginError> {
    if servers.is_empty() && skills.is_empty() {
        return Ok(None);
    }
    let plugin_dir = asset_dir
        .join("run_skills")
        .join(run_id)
        .join("cursor_plugin");
    let manifest_dir = plugin_dir.join(".cursor-plugin");
    fs::create_dir_all(&manifest_dir)?;
    fs::write(
        manifest_dir.join("plugin.json"),
        json!({"name": "hivedeck-run"}).to_string(),
    )?;
    if !servers.is_empty() {
        fs::write(
            plugin_dir.join(".mcp.json"),
            mcp_registry::cursor_mcp_config(servers),
        )?;
    }
    let skills_root = plugin_dir.join("skills");
    for skill in skills {
        let dst = skills_root.join(&skill.name);
        if dst.exists() {
            fs::remove_dir_all(&dst)?;
        }
        copy_dir_filtered(&skill.source_skill_dir, &dst)?;
    }
    Ok(Some(plugin_dir))
}

pub fn write_run_settings(
    asset_dir: &Path,
    run_id: &str,
    servers: &[InjectedMcpServer],
    qwen: bool,
) -> Result<PathBuf, PluginError> {
    let run_root = asset_dir.join("run_skills").join(run_id);
    fs::create_dir_all(&run_root)?;
    let path = run_root.join("settings.json");
    fs::write(
        &path,
        mcp_registry::gemini_family_settings(servers, None, qwen),
    )?;
    Ok(path)
}

/// Skills index for CLIs without native per-run skill loading: name,
/// description and `SKILL.md` path, prepended to the run's prompt.
pub fn skills_catalog(skill_dirs: &[PathBuf]) -> Option<String> {
    let mut lines = Vec::new();
    for dir in skill_dirs {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        let mut found: Vec<_> = entries.flatten().map(|entry| entry.path()).collect();
        found.sort();
        for skill_dir in found {
            let skill_md = skill_dir.join("SKILL.md");
            let Ok(text) = fs::read_to_string(&skill_md) else {
                continue;
            };
            let field = |key: &str| {
                text.strip_prefix("---")
                    .and_then(|rest| rest.split("\n---").next())
                    .and_then(|front| {
                        front
                            .lines()
                            .find_map(|line| line.strip_prefix(&format!("{key}:")))
                    })
                    .map(|value| value.trim().trim_matches(['"', '\'']).to_string())
            };
            let name = field("name").unwrap_or_else(|| {
                skill_dir
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default()
            });
            lines.push(format!(
                "- {name}: {} ({})",
                field("description").unwrap_or_default(),
                skill_md.display()
            ));
        }
    }
    (!lines.is_empty()).then(|| {
        format!(
            "Available skills (read the SKILL.md file before using one):\n{}\n\n",
            lines.join("\n")
        )
    })
}

pub fn opencode_skills_config(skill_dirs: &[PathBuf], existing: Option<&str>) -> String {
    let mut config: Value = existing
        .and_then(|value| serde_json::from_str(value).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !config.get("skills").is_some_and(Value::is_object) {
        config["skills"] = serde_json::json!({});
    }
    let skills_obj = config["skills"].as_object_mut().unwrap();
    if !skills_obj.get("paths").is_some_and(Value::is_array) {
        skills_obj.insert("paths".into(), serde_json::json!([]));
    }
    let paths = skills_obj["paths"].as_array_mut().unwrap();
    for dir in skill_dirs {
        let dir_str = dir.to_string_lossy().to_string();
        if !paths.iter().any(|item| item.as_str() == Some(&dir_str)) {
            paths.push(Value::String(dir_str));
        }
    }
    config.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marketplace_subdirectory_is_pinned_and_confined() {
        let repo = TempDir::new().unwrap();
        fs::create_dir(repo.path().join("plugin")).unwrap();
        fs::write(repo.path().join("plugin/data"), "fixture").unwrap();
        fs::create_dir(repo.path().join("plugin/.claude-plugin")).unwrap();
        fs::write(
            repo.path().join("plugin/.claude-plugin/plugin.json"),
            r#"{"name":"nover"}"#,
        )
        .unwrap();
        for args in [
            vec!["init"],
            vec!["add", "."],
            vec![
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "fixture",
            ],
        ] {
            assert!(
                Command::new("git")
                    .arg("-C")
                    .arg(repo.path())
                    .args(args)
                    .output()
                    .unwrap()
                    .status
                    .success()
            );
        }
        let source = format!("marketplace+file://{}#plugin", repo.path().display());
        let (_stage, root, commit, _) = stage_source(&source, None, None, true).unwrap();
        assert_eq!(fs::read_to_string(root.join("data")).unwrap(), "fixture");
        let preview = preview_plugin(InstallPluginRequest {
            source: source.clone(),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(preview.name, "nover");
        assert_eq!(preview.commit.as_deref(), commit.as_deref());
        assert_eq!(
            preview.version,
            commit.as_deref().unwrap()[..12].to_string()
        );
        assert!(stage_source(&source, None, None, false).is_err());
        assert!(stage_source(&source, commit.as_deref(), None, false).is_ok());
        assert!(
            stage_source(
                &format!("marketplace+file://{}#../outside", repo.path().display()),
                None,
                None,
                true
            )
            .is_err()
        );
    }

    #[test]
    fn legacy_migration_is_restart_safe_and_preserves_scope_and_secrets() {
        let dir = TempDir::new().unwrap();
        let entries = serde_json::json!([
            {"name":"first", "transport":"http", "url":"https://example.com/mcp", "headers":{"Authorization":"token"}, "roles":["captain"], "boards":["board"], "oauth":true},
            {"name":"second", "transport":"stdio", "command":"server", "env":{"KEY":"token"}, "roles":["crew"]}
        ]);
        fs::write(
            dir.path().join("mcp_registry.json"),
            serde_json::to_vec(&entries).unwrap(),
        )
        .unwrap();
        fs::write(
            dir.path().join("mcp_secrets.json"),
            br#"{"token":"secret"}"#,
        )
        .unwrap();
        migrate_mcp_registry(dir.path()).unwrap();
        let plugins = read_plugins(dir.path()).unwrap();
        assert_eq!(plugins.len(), 2);
        assert!(plugins[0].mcp[0].oauth);
        assert_eq!(plugins[0].mcp[0].boards, ["board"]);
        assert_eq!(plugins[0].mcp[0].roles, ["captain"]);
        assert_eq!(
            read_plugin_secrets(dir.path()).unwrap()["first"]["first"]["token"],
            "secret"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(secrets_path(dir.path()))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        fs::copy(
            dir.path().join("mcp_registry.json.bak"),
            dir.path().join("mcp_registry.json"),
        )
        .unwrap();
        migrate_mcp_registry(dir.path()).unwrap();
        migrate_mcp_registry(dir.path()).unwrap();
        assert_eq!(read_plugins(dir.path()).unwrap(), plugins);
        assert!(dir.path().join("mcp_registry.json.bak").exists());
        for cli in KNOWN_CLIS {
            for (role, board, expected) in [
                ("captain", Some("board"), "first"),
                ("crew", None, "second"),
            ] {
                let (servers, _) = select_mcp_for_run(
                    dir.path(),
                    vec![],
                    &BTreeMap::new(),
                    &plugins,
                    &read_plugin_secrets(dir.path()).unwrap(),
                    cli,
                    role,
                    board,
                )
                .unwrap();
                assert_eq!(servers.len(), 1);
                assert_eq!(servers[0].name, expected);
            }
        }
    }

    #[test]
    fn legacy_migration_refuses_duplicate_names_without_touching_source() {
        let dir = TempDir::new().unwrap();
        let bytes = br#"[{"name":"same","transport":"stdio","command":"a","roles":["crew"]},{"name":"same","transport":"stdio","command":"b","roles":["crew"]}]"#;
        fs::write(dir.path().join("mcp_registry.json"), bytes).unwrap();
        assert!(migrate_mcp_registry(dir.path()).is_err());
        assert_eq!(
            fs::read(dir.path().join("mcp_registry.json")).unwrap(),
            bytes
        );
        assert!(!plugins_path(dir.path()).exists());
    }

    #[test]
    fn legacy_migration_retries_after_partial_write_and_rejects_collision() {
        let dir = TempDir::new().unwrap();
        let bytes = br#"[{"name":"same","transport":"stdio","command":"a","env":{"KEY":"token"},"roles":["crew"]}]"#;
        fs::write(dir.path().join("mcp_registry.json"), bytes).unwrap();
        fs::write(dir.path().join("mcp_registry.json.bak"), bytes).unwrap();
        fs::write(
            dir.path().join("mcp_secrets.json"),
            br#"{"token":"secret"}"#,
        )
        .unwrap();
        let secrets: PluginsSecrets = BTreeMap::from([(
            "same".into(),
            BTreeMap::from([(
                "same".into(),
                BTreeMap::from([("token".into(), "secret".into())]),
            )]),
        )]);
        write_atomic(&secrets_path(dir.path()), &secrets, true).unwrap();
        migrate_mcp_registry(dir.path()).unwrap();
        assert_eq!(read_plugins(dir.path()).unwrap().len(), 1);

        let other = TempDir::new().unwrap();
        fs::write(other.path().join("mcp_registry.json"), bytes).unwrap();
        let entry = PluginMcpEntry {
            name: "same".into(),
            transport: "stdio".into(),
            command: Some("different".into()),
            args: vec![],
            url: None,
            headers: BTreeMap::new(),
            env: BTreeMap::new(),
            roles: vec!["crew".into()],
            boards: vec![],
            oauth: false,
            enabled: true,
            tool_policies: BTreeMap::new(),
            instructions: None,
            server_instructions: None,
        };
        install_plugin(
            other.path(),
            InstallPluginRequest {
                single_mcp: Some(entry),
                conflict_policy: ConflictPolicy::Overwrite,
                ..Default::default()
            },
        )
        .unwrap();
        let before = fs::read(plugins_path(other.path())).unwrap();
        assert!(migrate_mcp_registry(other.path()).is_err());
        assert_eq!(fs::read(plugins_path(other.path())).unwrap(), before);
        assert_eq!(
            fs::read(other.path().join("mcp_registry.json")).unwrap(),
            bytes
        );
    }

    #[test]
    fn single_mcp_preview_install_and_injection() {
        let dir = TempDir::new().unwrap();
        let entry = PluginMcpEntry {
            name: "example".into(),
            transport: "http".into(),
            command: None,
            args: vec![],
            url: Some("https://example.com/mcp".into()),
            headers: BTreeMap::from([("Authorization".into(), "TOKEN".into())]),
            env: BTreeMap::new(),
            roles: vec!["crew".into()],
            boards: vec!["board".into()],
            oauth: true,
            enabled: true,
            tool_policies: BTreeMap::new(),
            instructions: None,
            server_instructions: None,
        };
        let req = InstallPluginRequest {
            source: String::new(),
            single_mcp: Some(entry),
            secrets: BTreeMap::from([(
                "example".into(),
                BTreeMap::from([("TOKEN".into(), "secret".into())]),
            )]),
            ..Default::default()
        };
        assert_eq!(preview_plugin(req.clone()).unwrap().source, "mcp-single");
        install_plugin(dir.path(), req.clone()).unwrap();
        assert!(install_plugin(dir.path(), req).is_err());
        assert!(
            !fs::read_to_string(plugins_path(dir.path()))
                .unwrap()
                .contains("secret")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(secrets_path(dir.path()))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        for cli in KNOWN_CLIS {
            let (servers, vars) = select_mcp_for_run(
                dir.path(),
                vec![],
                &BTreeMap::new(),
                &read_plugins(dir.path()).unwrap(),
                &read_plugin_secrets(dir.path()).unwrap(),
                cli,
                "crew",
                Some("board"),
            )
            .unwrap();
            assert_eq!(servers.len(), 1);
            assert!(vars.values().any(|value| value == "secret"));
        }
    }

    fn fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample-plugin")
    }

    fn copy_dir_all(src: &Path, dst: &Path) {
        copy_dir_filtered(src, dst).unwrap();
    }

    #[test]
    fn install_hash_stability_scope_and_uninstall_preserve_source() {
        let asset_dir = TempDir::new().unwrap();
        let src_dir = TempDir::new().unwrap();
        let plugin_src = src_dir.path().join("sample-plugin");
        copy_dir_all(&fixture_dir(), &plugin_src);

        let installed = install_plugin(
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

        assert_eq!(installed.name, "sample-plugin");
        assert_eq!(installed.version, "1.0.0");
        assert_eq!(installed.unsupported, vec!["hooks"]);
        assert_eq!(installed.mcp.len(), 1);
        assert_eq!(installed.mcp[0].name, "fixture-tool");
        assert_eq!(installed.skills.len(), 1);
        assert_eq!(installed.skills[0].name, "fixture-skill");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(secrets_path(asset_dir.path()))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }

        // Asset hash stays identical across read, enable/disable, and run injection.
        let initial_hash = installed.asset_hash.clone();
        set_plugin_enabled(asset_dir.path(), "sample-plugin", false).unwrap();
        let after_disable = set_plugin_enabled(asset_dir.path(), "sample-plugin", true).unwrap();
        assert_eq!(after_disable.asset_hash, initial_hash);
        assert_eq!(
            compute_dir_hash(&plugin_asset_dir(asset_dir.path(), "sample-plugin")).unwrap(),
            initial_hash
        );

        // Scope filtering and injection per CLI.
        let plugins = read_plugins(asset_dir.path()).unwrap();
        let secrets = read_plugin_secrets(asset_dir.path()).unwrap();

        let (empty_mcp, _) = select_mcp_for_run(
            asset_dir.path(),
            vec![],
            &BTreeMap::new(),
            &plugins,
            &secrets,
            "claude_code",
            "captain",
            Some("board-1"),
        )
        .unwrap();
        assert!(empty_mcp.is_empty());

        for cli in KNOWN_CLIS {
            let (servers, vars) = select_mcp_for_run(
                asset_dir.path(),
                vec![],
                &BTreeMap::new(),
                &plugins,
                &secrets,
                cli,
                "crew",
                Some("board-1"),
            )
            .unwrap();
            assert_eq!(servers.len(), 1);
            assert!(servers[0].args[0].contains("plugins/sample-plugin/mcp-server.mjs"));
            assert_eq!(
                vars.values().next().map(String::as_str),
                Some("secret-fixture-value")
            );

            let selected_skills =
                select_skills_for_run(asset_dir.path(), &plugins, cli, "crew", Some("board-1"));
            assert_eq!(selected_skills.len(), 1);
            let run_dirs = materialize_run_skills(
                asset_dir.path(),
                &format!("run-{cli}"),
                cli,
                &selected_skills,
            )
            .unwrap();
            if cli_supports_skills(cli) {
                assert_eq!(run_dirs.len(), 1);
                if cli == "claude_code" {
                    assert!(
                        run_dirs[0]
                            .join(".claude/skills/fixture-skill/SKILL.md")
                            .is_file()
                    );
                } else if cli == "cursor_agent" {
                    assert!(run_dirs[0].join(".cursor-plugin/plugin.json").is_file());
                    assert!(run_dirs[0].join("skills/fixture-skill/SKILL.md").is_file());
                } else {
                    assert!(run_dirs[0].join("fixture-skill/SKILL.md").is_file());
                    if cli == "opencode" {
                        let oc = opencode_skills_config(&run_dirs, None);
                        assert!(oc.contains("skills"));
                        assert!(oc.contains(&run_dirs[0].to_string_lossy().to_string()));
                    }
                }
            } else {
                assert!(run_dirs.is_empty());
                assert!(
                    asset_dir
                        .path()
                        .join(format!(
                            "run_skills/run-{cli}/skills/fixture-skill/SKILL.md"
                        ))
                        .is_file()
                );
            }
            cleanup_run_skills(asset_dir.path(), &format!("run-{cli}"));
            assert!(
                !asset_dir
                    .path()
                    .join(format!("run_skills/run-{cli}"))
                    .exists()
            );
        }

        // Uninstall deletes copied assets + secrets, leaves original source untouched.
        uninstall_plugin(asset_dir.path(), "sample-plugin").unwrap();
        assert!(read_plugins(asset_dir.path()).unwrap().is_empty());
        assert!(read_plugin_secrets(asset_dir.path()).unwrap().is_empty());
        assert!(!plugin_asset_dir(asset_dir.path(), "sample-plugin").exists());
        assert!(plugin_src.join(".claude-plugin/plugin.json").is_file());
        assert!(plugin_src.join("skills/fixture-skill/SKILL.md").is_file());
    }

    #[test]
    fn allows_non_secret_literal_header_while_still_rejecting_plaintext_secrets() {
        let asset_dir = TempDir::new().unwrap();
        let src_dir = TempDir::new().unwrap();
        let pkg = src_dir.path().join("figma-plugin");
        fs::create_dir_all(pkg.join(".claude-plugin")).unwrap();
        fs::write(
            pkg.join(".claude-plugin/plugin.json"),
            r#"{"name":"figma-plugin","version":"1.0.0","mcpServers":"./.mcp.json"}"#,
        )
        .unwrap();
        fs::write(
            pkg.join(".mcp.json"),
            r#"{"mcpServers":{"figma":{"type":"http","url":"https://mcp.figma.com/mcp","headers":{"X-Figma-Env":"figma_prod@2_2_211"}}}}"#,
        )
        .unwrap();
        let installed = install_plugin(
            asset_dir.path(),
            InstallPluginRequest {
                source: pkg.to_string_lossy().to_string(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            installed.mcp[0]
                .headers
                .get("X-Figma-Env")
                .map(String::as_str),
            Some("literal_X-Figma-Env")
        );
        let secrets = read_plugin_secrets(asset_dir.path()).unwrap();
        assert_eq!(
            secrets["figma-plugin"]["figma"]["literal_X-Figma-Env"],
            "figma_prod@2_2_211"
        );
    }

    #[test]
    fn validates_manifest_secret_placeholder_and_version_pin() {
        let asset_dir = TempDir::new().unwrap();
        let src_dir = TempDir::new().unwrap();
        let pkg = src_dir.path().join("bad-plugin");
        fs::create_dir_all(pkg.join(".claude-plugin")).unwrap();
        fs::write(
            pkg.join(".claude-plugin/plugin.json"),
            r#"{"name":"bad-plugin","version":"1.0.0","mcpServers":"./.mcp.json"}"#,
        )
        .unwrap();
        // Plaintext secret rejected.
        fs::write(
            pkg.join(".mcp.json"),
            r#"{"mcpServers":{"s":{"type":"http","url":"https://example.test/mcp","headers":{"Authorization":"Bearer sk-plaintext"}}}}"#,
        )
        .unwrap();
        let err = install_plugin(
            asset_dir.path(),
            InstallPluginRequest {
                source: pkg.to_string_lossy().to_string(),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(err, PluginError::BadRequest(_)));

        // Fix placeholder, test wrong version pin.
        fs::write(
            pkg.join(".mcp.json"),
            r#"{"mcpServers":{"s":{"type":"http","url":"https://example.test/mcp","headers":{"Authorization":"Bearer ${API_TOKEN}"}}}}"#,
        )
        .unwrap();
        let err = install_plugin(
            asset_dir.path(),
            InstallPluginRequest {
                source: pkg.to_string_lossy().to_string(),
                version: Some("9.9.9".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(err, PluginError::BadRequest(_)));

        // Remote git without commit/tag rejected.
        let err = install_plugin(
            asset_dir.path(),
            InstallPluginRequest {
                source: "https://github.com/example/plugin.git".into(),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(err, PluginError::BadRequest(_)));
    }

    #[test]
    fn conflict_abort_skip_overwrite_and_upgrade_rollback() {
        let asset_dir = TempDir::new().unwrap();
        let src_dir = TempDir::new().unwrap();

        let p1 = src_dir.path().join("p1");
        copy_dir_all(&fixture_dir(), &p1);
        fs::write(
            p1.join(".claude-plugin/plugin.json"),
            r#"{"name":"p1","version":"1.0.0","mcpServers":"./.mcp.json","skills":"./skills"}"#,
        )
        .unwrap();

        // Git repo for p1 so we can test commit/tag upgrade + rollback.
        Command::new("git")
            .arg("init")
            .current_dir(&p1)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "t@t.local"])
            .current_dir(&p1)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "t"])
            .current_dir(&p1)
            .output()
            .unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&p1)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "v1"])
            .current_dir(&p1)
            .output()
            .unwrap();
        Command::new("git")
            .args(["tag", "v1.0.0"])
            .current_dir(&p1)
            .output()
            .unwrap();

        let installed_p1 = install_plugin(
            asset_dir.path(),
            InstallPluginRequest {
                source: p1.to_string_lossy().to_string(),
                tag: Some("v1.0.0".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(installed_p1.tag.as_deref(), Some("v1.0.0"));
        assert!(installed_p1.commit.is_some());

        // Second plugin with colliding MCP + skill name.
        let p2 = src_dir.path().join("p2");
        copy_dir_all(&fixture_dir(), &p2);
        fs::write(
            p2.join(".claude-plugin/plugin.json"),
            r#"{"name":"p2","version":"1.0.0","mcpServers":"./.mcp.json","skills":"./skills"}"#,
        )
        .unwrap();

        // Abort by default.
        let err = install_plugin(
            asset_dir.path(),
            InstallPluginRequest {
                source: p2.to_string_lossy().to_string(),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(err, PluginError::Conflict(_)));
        assert!(!plugin_asset_dir(asset_dir.path(), "p2").exists());

        // Skip keeps p1 active and disables colliding entries on p2.
        let p2_skipped = install_plugin(
            asset_dir.path(),
            InstallPluginRequest {
                source: p2.to_string_lossy().to_string(),
                conflict_policy: ConflictPolicy::Skip,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!p2_skipped.mcp[0].enabled);
        assert!(!p2_skipped.skills[0].enabled);
        assert_eq!(p2_skipped.notes.len(), 2);

        uninstall_plugin(asset_dir.path(), "p2").unwrap();

        // Overwrite enables p2 and disables colliding entries on p1.
        let p2_over = install_plugin(
            asset_dir.path(),
            InstallPluginRequest {
                source: p2.to_string_lossy().to_string(),
                conflict_policy: ConflictPolicy::Overwrite,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(p2_over.mcp[0].enabled);
        assert!(p2_over.skills[0].enabled);
        let plugins_now = read_plugins(asset_dir.path()).unwrap();
        let p1_now = plugins_now.iter().find(|p| p.name == "p1").unwrap();
        assert!(!p1_now.mcp[0].enabled);
        assert!(!p1_now.skills[0].enabled);

        // Upgrade p1 to v2.0.0 tag.
        fs::write(
            p1.join(".claude-plugin/plugin.json"),
            r#"{"name":"p1","version":"2.0.0","mcpServers":"./.mcp.json","skills":"./skills"}"#,
        )
        .unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&p1)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "v2"])
            .current_dir(&p1)
            .output()
            .unwrap();
        Command::new("git")
            .args(["tag", "v2.0.0"])
            .current_dir(&p1)
            .output()
            .unwrap();

        // Failed upgrade (bad pin) preserves existing v1.0.0 asset & hash (rollback).
        let fail_upgrade = upgrade_plugin(
            asset_dir.path(),
            "p1",
            UpgradePluginRequest {
                tag: Some("v9.9.9".into()),
                ..Default::default()
            },
        );
        assert!(fail_upgrade.is_err());
        let p1_after_fail = read_plugins(asset_dir.path())
            .unwrap()
            .into_iter()
            .find(|p| p.name == "p1")
            .unwrap();
        assert_eq!(p1_after_fail.version, "1.0.0");
        assert_eq!(p1_after_fail.asset_hash, installed_p1.asset_hash);

        let upgraded = upgrade_plugin(
            asset_dir.path(),
            "p1",
            UpgradePluginRequest {
                tag: Some("v2.0.0".into()),
                conflict_policy: ConflictPolicy::Skip,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(upgraded.version, "2.0.0");
        assert_eq!(upgraded.tag.as_deref(), Some("v2.0.0"));
        assert_ne!(upgraded.asset_hash, installed_p1.asset_hash);
    }

    #[test]
    fn every_base_coding_agent_is_covered_in_compatibility_matrix() {
        let matrix = executor_compatibility();
        for agent in BaseCodingAgent::iter() {
            let entry = matrix
                .iter()
                .find(|item| item.executor == agent)
                .unwrap_or_else(|| panic!("missing compatibility entry for {agent}"));
            match plugin_cli_key(agent) {
                Some(cli) => {
                    assert!(
                        KNOWN_CLIS.contains(&cli),
                        "{agent} maps to unknown cli {cli}"
                    );
                    assert_eq!(entry.cli.as_deref(), Some(cli));
                    assert_eq!(entry.mcp, InjectionSupport::Supported);
                    assert!(!entry.mcp_mechanism.is_empty());
                    assert!(!entry.skills_mechanism.is_empty());
                }
                None => {
                    assert_eq!(entry.mcp, InjectionSupport::Unsupported);
                    assert_eq!(entry.skills, InjectionSupport::Unsupported);
                    assert!(!entry.mcp_mechanism.is_empty());
                    assert!(!entry.skills_mechanism.is_empty());
                }
            }
        }
        let codex = matrix
            .iter()
            .find(|item| item.executor == BaseCodingAgent::Codex)
            .unwrap();
        assert_eq!(codex.skills, InjectionSupport::Unsupported);
        assert!(!codex.skills_mechanism.is_empty());
    }

    #[test]
    fn new_cli_per_run_materialization_and_catalog_snapshots() {
        let asset_dir = TempDir::new().unwrap();
        let skill_src = asset_dir.path().join("src-skill");
        fs::create_dir_all(&skill_src).unwrap();
        fs::write(
            skill_src.join("SKILL.md"),
            "---\nname: probe-skill\ndescription: Probe skill desc\n---\nBody\n",
        )
        .unwrap();
        let selected = vec![SelectedSkill {
            plugin_name: "p".into(),
            name: "probe-skill".into(),
            source_skill_dir: skill_src,
        }];
        let servers = vec![InjectedMcpServer {
            name: "probe".into(),
            transport: "stdio".into(),
            command: Some("srv".into()),
            args: vec!["--x".into()],
            url: None,
            headers: BTreeMap::new(),
            env: BTreeMap::from([("TOKEN".into(), "HIVEDECK_MCP_PROBE_TOKEN".into())]),
            instructions: None,
        }];

        assert!(
            write_cursor_plugin_dir(asset_dir.path(), "empty-cursor", &[], &[])
                .unwrap()
                .is_none()
        );
        let cursor_dir =
            write_cursor_plugin_dir(asset_dir.path(), "run-cursor", &servers, &selected)
                .unwrap()
                .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(
                &fs::read_to_string(cursor_dir.join(".cursor-plugin/plugin.json")).unwrap()
            )
            .unwrap(),
            json!({"name": "hivedeck-run"})
        );
        assert_eq!(
            serde_json::from_str::<Value>(
                &fs::read_to_string(cursor_dir.join(".mcp.json")).unwrap()
            )
            .unwrap(),
            json!({"mcpServers": {"probe": {"command": "srv", "args": ["--x"], "env": {"TOKEN": "${HIVEDECK_MCP_PROBE_TOKEN}"}}}})
        );
        assert!(cursor_dir.join("skills/probe-skill/SKILL.md").is_file());

        let droid_path = write_droid_settings(asset_dir.path(), "run-droid", &servers).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(&droid_path).unwrap()).unwrap(),
            json!({"mcp": {"mcpServers": {"probe": {"type": "stdio", "command": "srv", "args": ["--x"], "env": {"TOKEN": "${HIVEDECK_MCP_PROBE_TOKEN}"}}}}})
        );

        for cli in ["amp", "copilot", "droid"] {
            let run_id = format!("run-{cli}");
            let dirs = materialize_run_skills(asset_dir.path(), &run_id, cli, &selected).unwrap();
            assert_eq!(dirs.len(), 1);
            let skill_md = dirs[0].join("probe-skill/SKILL.md");
            assert!(skill_md.is_file());
            if matches!(cli, "amp" | "droid") {
                let catalog = skills_catalog(&dirs).unwrap();
                assert_eq!(
                    catalog,
                    format!(
                        "Available skills (read the SKILL.md file before using one):\n- probe-skill: Probe skill desc ({})\n\n",
                        skill_md.display()
                    )
                );
            }
            cleanup_run_skills(asset_dir.path(), &run_id);
            assert!(!asset_dir.path().join("run_skills").join(&run_id).exists());
        }
        cleanup_run_skills(asset_dir.path(), "run-cursor");
        cleanup_run_skills(asset_dir.path(), "run-droid");
        assert!(!cursor_dir.exists());
        assert!(!droid_path.exists());
    }
}
