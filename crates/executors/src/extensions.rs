//! Per-CLI control over what a headless agent run loads (ADR-038).
//!
//! The owner installs skills, MCP servers, hooks and plugins for their own
//! interactive use; a headless run loads all of them too, and each one costs
//! prompt tokens (skill and tool descriptions) or time (hooks) on every turn.
//! HiveDeck never hardcodes which ones to cut: it lists what each CLI has
//! installed ([`inventory`]) and lets the owner switch items off for
//! HiveDeck's headless runs only ([`ExtensionPrefs`]). Nothing here edits the
//! CLI's own config; the choices are applied as per-run flags.

use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{Mutex, RwLock},
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

/// How a skill is offered to the model in a headless run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
pub enum SkillMode {
    /// Listed with its description (the CLI's default).
    #[default]
    On,
    /// Listed by name only: still usable, much cheaper.
    NameOnly,
    /// Not offered at all.
    Off,
}

/// The owner's choices for one CLI. Absent entries mean "as installed".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct CliExtensionPrefs {
    /// Skill name → mode; skills not listed stay on.
    #[serde(default)]
    pub skills: BTreeMap<String, SkillMode>,
    /// MCP servers switched off for headless runs.
    #[serde(default)]
    pub disabled_mcp: BTreeSet<String>,
    /// Plugins switched off for headless runs.
    #[serde(default)]
    pub disabled_plugins: BTreeSet<String>,
    /// Skip the owner's hooks in headless runs.
    #[serde(default)]
    pub disable_hooks: bool,
    /// Drop the skills bundled with the CLI itself.
    #[serde(default)]
    pub disable_bundled_skills: bool,
    /// Keep per-machine details out of the system prompt so the prompt
    /// cache is reused across runs. No capability is lost.
    #[serde(default = "default_true")]
    pub cache_friendly_prompt: bool,
    /// Stop a single run once it has spent this much (USD, as the CLI
    /// estimates it). `None` = no cap.
    #[serde(default)]
    pub max_budget_usd: Option<f64>,
}

fn default_true() -> bool {
    true
}

impl Default for CliExtensionPrefs {
    fn default() -> Self {
        Self {
            skills: BTreeMap::new(),
            disabled_mcp: BTreeSet::new(),
            disabled_plugins: BTreeSet::new(),
            disable_hooks: false,
            disable_bundled_skills: false,
            cache_friendly_prompt: true,
            max_budget_usd: None,
        }
    }
}

/// Every CLI's choices, keyed by CLI (`CLAUDE_CODE`, `CODEX`, …).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
pub struct ExtensionPrefs {
    #[serde(default)]
    pub clis: BTreeMap<String, CliExtensionPrefs>,
}

/// The CLIs HiveDeck knows how to inventory and control.
pub const SUPPORTED_CLIS: [&str; 9] = [
    "CLAUDE_CODE",
    "CODEX",
    "OPENCODE",
    "GEMINI",
    "CURSOR_AGENT",
    "COPILOT",
    "QWEN_CODE",
    "AMP",
    "DROID",
];

static CACHE: RwLock<Option<ExtensionPrefs>> = RwLock::new(None);
static WRITE_LOCK: Mutex<()> = Mutex::new(());

fn prefs_path() -> PathBuf {
    workspace_utils::assets::asset_dir().join("agent_extensions.json")
}

impl ExtensionPrefs {
    /// The saved choices (cached after the first read).
    pub fn load() -> Self {
        if let Ok(guard) = CACHE.read()
            && let Some(prefs) = guard.as_ref()
        {
            return prefs.clone();
        }
        let prefs = std::fs::read_to_string(prefs_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if let Ok(mut guard) = CACHE.write() {
            *guard = Some(Self::clone(&prefs));
        }
        prefs
    }

    pub fn save(&self) -> std::io::Result<()> {
        let json = serde_json::to_string_pretty(self).map_err(std::io::Error::other)?;
        std::fs::write(prefs_path(), json)?;
        if let Ok(mut guard) = CACHE.write() {
            *guard = Some(self.clone());
        }
        Ok(())
    }

    pub fn set_cli(cli: &str, prefs: CliExtensionPrefs) -> std::io::Result<()> {
        let _guard = WRITE_LOCK
            .lock()
            .map_err(|_| std::io::Error::other("ExtensionPrefs lock poisoned"))?;
        let mut all = Self::load();
        all.clis.insert(cli.to_owned(), prefs);
        all.save()
    }

    pub fn for_cli(&self, cli: &str) -> CliExtensionPrefs {
        self.clis.get(cli).cloned().unwrap_or_default()
    }
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, TS)]
pub struct InstalledItem {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    /// Where it was found (a path or config file), for the owner's reference.
    pub source: String,
    /// Whether HiveDeck can switch it off for this CLI.
    pub toggleable: bool,
}

/// What one CLI has installed, as HiveDeck can see it.
#[derive(Debug, Clone, Serialize, TS)]
pub struct CliInventory {
    pub cli: String,
    pub skills: Vec<InstalledItem>,
    pub mcp_servers: Vec<InstalledItem>,
    pub plugins: Vec<InstalledItem>,
    pub subagents: Vec<InstalledItem>,
    /// Hook events with how many hooks each runs.
    pub hooks: Vec<InstalledItem>,
    /// Which switches this CLI honours.
    pub supports: CliSupports,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
pub struct CliSupports {
    pub skill_modes: bool,
    pub mcp: bool,
    pub plugins: bool,
    pub hooks: bool,
    pub bundled_skills: bool,
    pub cache_friendly_prompt: bool,
    pub max_budget: bool,
}

struct GenericCliSpec {
    cli: &'static str,
    root_dir: &'static str,
    config_file: &'static str,
    mcp_key: &'static str,
    skill_dirs: &'static [&'static str],
}

const GENERIC_CLI_SPECS: &[GenericCliSpec] = &[
    GenericCliSpec {
        cli: "OPENCODE",
        root_dir: ".config/opencode",
        config_file: ".config/opencode/opencode.json",
        mcp_key: "mcp",
        skill_dirs: &[".config/opencode/skills"],
    },
    GenericCliSpec {
        cli: "GEMINI",
        root_dir: ".gemini",
        config_file: ".gemini/settings.json",
        mcp_key: "mcpServers",
        skill_dirs: &[".gemini/skills"],
    },
    GenericCliSpec {
        cli: "CURSOR_AGENT",
        root_dir: ".cursor",
        config_file: ".cursor/mcp.json",
        mcp_key: "mcpServers",
        skill_dirs: &[".cursor/skills"],
    },
    GenericCliSpec {
        cli: "COPILOT",
        root_dir: ".copilot",
        config_file: ".copilot/mcp-config.json",
        mcp_key: "mcpServers",
        skill_dirs: &[".copilot/skills"],
    },
    GenericCliSpec {
        cli: "QWEN_CODE",
        root_dir: ".qwen",
        config_file: ".qwen/settings.json",
        mcp_key: "mcpServers",
        skill_dirs: &[".qwen/skills"],
    },
    GenericCliSpec {
        cli: "AMP",
        root_dir: ".config/amp",
        config_file: ".config/amp/settings.json",
        mcp_key: "amp.mcpServers",
        skill_dirs: &[".config/agents/skills", ".config/amp/skills"],
    },
    GenericCliSpec {
        cli: "DROID",
        root_dir: ".factory",
        config_file: ".factory/mcp.json",
        mcp_key: "mcpServers",
        skill_dirs: &[".factory/skills"],
    },
];

pub fn inventory(cli: &str) -> Option<CliInventory> {
    let home = dirs::home_dir()?;
    match cli {
        "CLAUDE_CODE" => Some(claude_inventory(&home)),
        "CODEX" => Some(codex_inventory(&home)),
        other => GENERIC_CLI_SPECS
            .iter()
            .find(|spec| spec.cli == other)
            .and_then(|spec| generic_cli_inventory(&home, spec)),
    }
}

fn generic_cli_inventory(home: &Path, spec: &GenericCliSpec) -> Option<CliInventory> {
    let has_root = home.join(spec.root_dir).exists()
        || home.join(spec.config_file).is_file()
        || spec.skill_dirs.iter().any(|dir| home.join(dir).is_dir());
    if !has_root {
        return None;
    }

    let config_path = home.join(spec.config_file);
    let config = read_json(&config_path);
    let source_label = format!("~/{}", spec.config_file);
    let mcp_obj = if spec.cli == "AMP" {
        config
            .get("amp.mcpServers")
            .or_else(|| config.get("amp").and_then(|v| v.get("mcpServers")))
            .and_then(Value::as_object)
    } else {
        config.get(spec.mcp_key).and_then(Value::as_object)
    };
    let mcp_servers = mcp_obj
        .map(|servers| {
            servers
                .keys()
                .map(|name| InstalledItem {
                    name: name.clone(),
                    description: None,
                    source: source_label.clone(),
                    toggleable: false,
                })
                .collect()
        })
        .unwrap_or_default();

    let mut skills = Vec::new();
    let mut seen_skills = BTreeSet::new();
    for rel in spec.skill_dirs {
        let label = format!("~/{rel}");
        for item in skill_dirs(&home.join(rel), &label, false) {
            if seen_skills.insert(item.name.clone()) {
                skills.push(item);
            }
        }
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));

    Some(CliInventory {
        cli: spec.cli.into(),
        skills,
        mcp_servers,
        plugins: Vec::new(),
        subagents: Vec::new(),
        hooks: Vec::new(),
        supports: CliSupports::default(),
    })
}

fn claude_inventory(home: &Path) -> CliInventory {
    let claude_dir = home.join(".claude");
    let settings = read_json(&claude_dir.join("settings.json"));
    let config = read_json(&home.join(".claude.json"));

    let mcp_servers = config
        .get("mcpServers")
        .and_then(Value::as_object)
        .map(|servers| {
            servers
                .keys()
                .map(|name| InstalledItem {
                    name: name.clone(),
                    description: None,
                    source: "~/.claude.json".into(),
                    toggleable: true,
                })
                .collect()
        })
        .unwrap_or_default();

    let plugins = settings
        .get("enabledPlugins")
        .and_then(Value::as_object)
        .map(|plugins| {
            plugins
                .iter()
                .filter(|(_, on)| on.as_bool() == Some(true))
                .map(|(name, _)| InstalledItem {
                    name: name.clone(),
                    description: None,
                    source: "~/.claude/settings.json".into(),
                    toggleable: true,
                })
                .collect()
        })
        .unwrap_or_default();

    CliInventory {
        cli: "CLAUDE_CODE".into(),
        skills: skill_dirs(&claude_dir.join("skills"), "~/.claude/skills", true),
        mcp_servers,
        plugins,
        subagents: agent_files(&claude_dir.join("agents")),
        hooks: hook_events(&settings, "~/.claude/settings.json"),
        supports: CliSupports {
            skill_modes: true,
            mcp: true,
            plugins: true,
            hooks: true,
            bundled_skills: true,
            cache_friendly_prompt: true,
            max_budget: true,
        },
    }
}

fn codex_inventory(home: &Path) -> CliInventory {
    let codex_dir = home.join(".codex");
    let config: toml::Table = std::fs::read_to_string(codex_dir.join("config.toml"))
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or_default();
    let mcp_servers = config
        .get("mcp_servers")
        .and_then(|v| v.as_table())
        .map(|servers| {
            servers
                .keys()
                .map(|name| InstalledItem {
                    name: name.clone(),
                    description: None,
                    source: "~/.codex/config.toml".into(),
                    toggleable: true,
                })
                .collect()
        })
        .unwrap_or_default();
    let plugins: Vec<InstalledItem> = config
        .get("plugins")
        .and_then(|v| v.as_table())
        .map(|plugins| {
            plugins
                .iter()
                .filter(|(_, val)| {
                    val.as_table()
                        .and_then(|t| t.get("enabled"))
                        .and_then(|e| e.as_bool())
                        != Some(false)
                })
                .map(|(name, _)| InstalledItem {
                    name: name.clone(),
                    description: None,
                    source: "~/.codex/config.toml".into(),
                    toggleable: true,
                })
                .collect()
        })
        .unwrap_or_default();
    let hooks = read_json(&codex_dir.join("hooks.json"));
    let mut skills = skill_dirs(&codex_dir.join("skills"), "~/.codex/skills", false);
    let mut seen_skills: BTreeSet<String> = skills.iter().map(|s| s.name.clone()).collect();
    for item in skill_dirs(&home.join(".agents/skills"), "~/.agents/skills", false) {
        if seen_skills.insert(item.name.clone()) {
            skills.push(item);
        }
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    CliInventory {
        cli: "CODEX".into(),
        skills,
        mcp_servers,
        plugins,
        subagents: Vec::new(),
        hooks: hook_events(&hooks, "~/.codex/hooks.json"),
        supports: CliSupports {
            mcp: true,
            plugins: true,
            ..Default::default()
        },
    }
}

fn read_json(path: &Path) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null)
}

/// `<dir>/<skill>/SKILL.md` entries, named and described by their front
/// matter. A folder without its own `SKILL.md` but with a `skills/` folder
/// is a bundle (a plugin-style package); its skills are named
/// `<bundle>:<skill>`, as the CLI names them.
fn skill_dirs(dir: &Path, label: &str, toggleable: bool) -> Vec<InstalledItem> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut items = Vec::new();
    for entry in entries.flatten() {
        let folder = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if let Some(item) = skill_item(&path, None, &format!("{label}/{folder}"), toggleable) {
            items.push(item);
            continue;
        }
        let Ok(nested) = std::fs::read_dir(path.join("skills")) else {
            continue;
        };
        for skill in nested.flatten() {
            let sub = skill.file_name().to_string_lossy().to_string();
            items.extend(skill_item(
                &skill.path(),
                Some(&folder),
                &format!("{label}/{folder}/skills/{sub}"),
                toggleable,
            ));
        }
    }
    items.sort_by(|a, b| a.name.cmp(&b.name));
    items
}

fn skill_item(
    dir: &Path,
    bundle: Option<&str>,
    source: &str,
    toggleable: bool,
) -> Option<InstalledItem> {
    let text = std::fs::read_to_string(dir.join("SKILL.md")).ok()?;
    let folder = dir.file_name()?.to_string_lossy().to_string();
    let (name, description) = front_matter(&text);
    let name = name.unwrap_or(folder);
    Some(InstalledItem {
        name: match bundle {
            Some(bundle) if !name.contains(':') => format!("{bundle}:{name}"),
            _ => name,
        },
        description,
        source: source.to_string(),
        toggleable,
    })
}

fn agent_files(dir: &Path) -> Vec<InstalledItem> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut items: Vec<InstalledItem> = entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "md"))
        .filter_map(|entry| {
            let text = std::fs::read_to_string(entry.path()).ok()?;
            let file = entry.file_name().to_string_lossy().to_string();
            let (name, description) = front_matter(&text);
            Some(InstalledItem {
                name: name.unwrap_or_else(|| file.trim_end_matches(".md").to_string()),
                description,
                source: format!("~/.claude/agents/{file}"),
                toggleable: false,
            })
        })
        .collect();
    items.sort_by(|a, b| a.name.cmp(&b.name));
    items
}

fn hook_events(settings: &Value, label: &str) -> Vec<InstalledItem> {
    settings
        .get("hooks")
        .and_then(Value::as_object)
        .map(|events| {
            events
                .iter()
                .map(|(event, groups)| {
                    let count: usize = groups
                        .as_array()
                        .map(|groups| {
                            groups
                                .iter()
                                .map(|g| {
                                    g.get("hooks").and_then(Value::as_array).map_or(1, Vec::len)
                                })
                                .sum()
                        })
                        .unwrap_or(0);
                    InstalledItem {
                        name: event.clone(),
                        description: Some(count.to_string()),
                        source: label.to_string(),
                        toggleable: false,
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// `name:` and `description:` from a `---` front-matter block.
fn front_matter(text: &str) -> (Option<String>, Option<String>) {
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }
    let mut name = None;
    let mut description = None;
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        let unquote = |v: &str| v.trim().trim_matches('"').trim_matches('\'').to_string();
        if let Some(v) = line.strip_prefix("name:") {
            name = Some(unquote(v)).filter(|s| !s.is_empty());
        } else if let Some(v) = line.strip_prefix("description:") {
            description = Some(unquote(v)).filter(|s| !s.is_empty());
        }
    }
    (name, description)
}

// ---------------------------------------------------------------------------
// Applying the choices
// ---------------------------------------------------------------------------

/// Extra flags for a headless Claude Code run. `extra_mcp` is a JSON
/// `--mcp-config` the run adds on its own (the captain's HiveDeck server);
/// it is folded in so a strict MCP config still includes it.
pub fn claude_args(
    prefs: &CliExtensionPrefs,
    cwd: &Path,
    extra_mcp: Option<&str>,
    model_overrides: &Map<String, Value>,
) -> Vec<String> {
    let home = dirs::home_dir().unwrap_or_default();
    claude_args_with(
        prefs,
        &read_json(&home.join(".claude.json")),
        cwd,
        extra_mcp,
        model_overrides,
    )
}

fn claude_args_with(
    prefs: &CliExtensionPrefs,
    claude_json: &Value,
    cwd: &Path,
    extra_mcp: Option<&str>,
    model_overrides: &Map<String, Value>,
) -> Vec<String> {
    let mut args = Vec::new();
    if prefs.cache_friendly_prompt {
        args.push("--exclude-dynamic-system-prompt-sections".to_string());
    }
    if let Some(cap) = prefs.max_budget_usd.filter(|c| *c > 0.0) {
        args.push(format!("--max-budget-usd={cap}"));
    }

    let mut settings = Map::new();
    let overrides: Map<String, Value> = prefs
        .skills
        .iter()
        .filter_map(|(name, mode)| {
            let value = match mode {
                SkillMode::On => return None,
                SkillMode::NameOnly => "name-only",
                SkillMode::Off => "off",
            };
            Some((name.clone(), Value::String(value.into())))
        })
        .collect();
    if !overrides.is_empty() {
        settings.insert("skillOverrides".into(), Value::Object(overrides));
    }
    if !prefs.disabled_plugins.is_empty() {
        let plugins: Map<String, Value> = prefs
            .disabled_plugins
            .iter()
            .map(|p| (p.clone(), Value::Bool(false)))
            .collect();
        settings.insert("enabledPlugins".into(), Value::Object(plugins));
    }
    if prefs.disable_hooks {
        settings.insert("disableAllHooks".into(), Value::Bool(true));
    }
    if prefs.disable_bundled_skills {
        settings.insert("disableBundledSkills".into(), Value::Bool(true));
    }
    if !model_overrides.is_empty() {
        settings.insert(
            "modelOverrides".into(),
            Value::Object(model_overrides.clone()),
        );
    }
    if !settings.is_empty() {
        args.push(format!("--settings={}", Value::Object(settings)));
    }

    if prefs.disabled_mcp.is_empty() {
        if let Some(extra) = extra_mcp {
            args.push(format!("--mcp-config={extra}"));
        }
    } else {
        // Claude has no per-server "off" switch for user servers, so load
        // exactly the ones still on: user scope, this project's scope and
        // its `.mcp.json`, plus the run's own.
        let mut servers = Map::new();
        let mut add = |source: Option<&Value>| {
            if let Some(map) = source.and_then(Value::as_object) {
                for (name, def) in map {
                    if !prefs.disabled_mcp.contains(name) {
                        servers.insert(name.clone(), def.clone());
                    }
                }
            }
        };
        add(claude_json.get("mcpServers"));
        add(claude_json
            .get("projects")
            .and_then(|p| p.get(cwd.to_string_lossy().as_ref()))
            .and_then(|p| p.get("mcpServers")));
        add(read_json(&cwd.join(".mcp.json")).get("mcpServers"));
        if let Some(extra) = extra_mcp.and_then(|e| serde_json::from_str::<Value>(e).ok())
            && let Some(extra) = extra.get("mcpServers").and_then(Value::as_object)
        {
            servers.extend(extra.clone());
        }
        let config = serde_json::json!({ "mcpServers": servers });
        args.push("--strict-mcp-config".to_string());
        args.push(format!("--mcp-config={config}"));
    }
    args
}

/// `modelOverrides` for a run whose model names are gateway aliases (9router
/// combos such as `planner`). Claude Code doesn't recognise those, prints a
/// `[claude-code:unrecognized_model]` diagnostic, and guesses the model's
/// window and features; mapping a real Claude model ID to each alias makes it
/// treat the alias as that model (ADR-040). `main_model` is the run's
/// `--model`; `env` holds the `ANTHROPIC_DEFAULT_*_MODEL` aliases.
pub fn gateway_model_overrides(
    main_model: Option<&str>,
    env: &std::collections::HashMap<String, String>,
) -> Map<String, Value> {
    let custom = |m: &str| {
        let m = m.trim();
        !m.is_empty()
            && !m.starts_with("claude-")
            && !["opus", "sonnet", "haiku", "fable", "best", "default"]
                .iter()
                .any(|a| m.eq_ignore_ascii_case(a) || m.starts_with(&format!("{a}[")))
    };
    let mut out = Map::new();
    let mut add = |claude_id: &str, alias: &str| {
        if custom(alias) && !out.contains_key(claude_id) && !out.values().any(|v| v == alias) {
            out.insert(claude_id.to_string(), Value::String(alias.to_string()));
        }
    };
    for (var, claude_id) in [
        ("ANTHROPIC_DEFAULT_OPUS_MODEL", "claude-opus-5-5"),
        ("ANTHROPIC_DEFAULT_FABLE_MODEL", "claude-fable-5-2"),
        ("ANTHROPIC_DEFAULT_SONNET_MODEL", "claude-sonnet-5-5"),
        ("ANTHROPIC_DEFAULT_HAIKU_MODEL", "claude-haiku-5-5"),
    ] {
        if let Some(alias) = env.get(var) {
            add(claude_id, alias);
        }
    }
    if let Some(main) = main_model {
        let lower = main.to_lowercase();
        let like = if lower.contains("fast") || lower.contains("haiku") {
            ["claude-haiku-5-5", "claude-haiku-4-5"]
        } else if lower.contains("plan") || lower.contains("review") || lower.contains("opus") {
            ["claude-opus-5-5", "claude-opus-5"]
        } else {
            ["claude-sonnet-5-5", "claude-sonnet-5"]
        };
        for id in like {
            add(id, main);
        }
    }
    out
}

fn toml_key_segment(name: &str) -> String {
    if !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        name.to_string()
    } else {
        format!("\"{}\"", name.replace('\\', "\\\\").replace('"', "\\\""))
    }
}

/// Codex config overrides (`thread/start` config and root `-c` flags) for the owner's choices.
pub fn codex_config_overrides(prefs: &CliExtensionPrefs) -> Vec<(String, Value)> {
    let mut out: Vec<(String, Value)> = prefs
        .disabled_mcp
        .iter()
        .filter(|name| name.as_str() != "hivedeck")
        .map(|name| {
            (
                format!("mcp_servers.{}.enabled", toml_key_segment(name)),
                Value::Bool(false),
            )
        })
        .collect();
    for name in &prefs.disabled_plugins {
        out.push((
            format!("plugins.{}.enabled", toml_key_segment(name)),
            Value::Bool(false),
        ));
    }
    // Codex's bundled `codex_apps` and `cua_repl` MCP servers are gated by
    // `[features]` flags in addition to `[plugins]`.
    if prefs
        .disabled_plugins
        .contains("codex-app-tools@openai-bundled")
    {
        out.push(("features.apps".to_string(), Value::Bool(false)));
    }
    if prefs
        .disabled_plugins
        .contains("computer-use@openai-bundled")
        || prefs
            .disabled_plugins
            .contains("unified-computer-use@openai-bundled")
    {
        out.push(("features.computer_use".to_string(), Value::Bool(false)));
    }
    if prefs.disabled_plugins.contains("browser@openai-bundled")
        || prefs.disabled_plugins.contains("chrome@openai-bundled")
    {
        out.push(("features.browser_use".to_string(), Value::Bool(false)));
    }
    out
}

/// Remove slash commands for skills/plugins the owner switched off in `ExtensionPrefs`.
pub fn filter_slash_commands(
    cli: &str,
    commands: Vec<crate::executors::SlashCommandDescription>,
) -> Vec<crate::executors::SlashCommandDescription> {
    let prefs = ExtensionPrefs::load().for_cli(cli);
    commands
        .into_iter()
        .filter(|cmd| {
            if prefs.skills.get(&cmd.name) == Some(&SkillMode::Off) {
                return false;
            }
            if let Some((prefix, _)) = cmd.name.split_once(':')
                && prefs.disabled_plugins.contains(prefix)
            {
                return false;
            }
            true
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_only_add_the_cache_flag() {
        let args = claude_args_with(
            &CliExtensionPrefs::default(),
            &Value::Null,
            Path::new("/x"),
            None,
            &Map::new(),
        );
        assert_eq!(args, vec!["--exclude-dynamic-system-prompt-sections"]);
    }

    #[test]
    fn captain_mcp_passes_through_when_nothing_is_disabled() {
        let prefs = CliExtensionPrefs {
            cache_friendly_prompt: false,
            ..Default::default()
        };
        let args = claude_args_with(
            &prefs,
            &Value::Null,
            Path::new("/x"),
            Some("{\"a\":1}"),
            &Map::new(),
        );
        assert_eq!(args, vec!["--mcp-config={\"a\":1}"]);
    }

    #[test]
    fn skills_hooks_and_budget_become_settings() {
        let mut prefs = CliExtensionPrefs {
            disable_hooks: true,
            max_budget_usd: Some(2.5),
            ..Default::default()
        };
        prefs
            .skills
            .insert("impeccable".into(), SkillMode::NameOnly);
        prefs.skills.insert("superset".into(), SkillMode::Off);
        prefs.skills.insert("kept".into(), SkillMode::On);
        let args = claude_args_with(&prefs, &Value::Null, Path::new("/x"), None, &Map::new());
        assert!(args.contains(&"--max-budget-usd=2.5".to_string()));
        let settings = args
            .iter()
            .find_map(|a| a.strip_prefix("--settings="))
            .unwrap();
        let v: Value = serde_json::from_str(settings).unwrap();
        assert_eq!(v["skillOverrides"]["impeccable"], "name-only");
        assert_eq!(v["skillOverrides"]["superset"], "off");
        assert!(v["skillOverrides"].get("kept").is_none());
        assert_eq!(v["disableAllHooks"], true);
    }

    #[test]
    fn disabled_mcp_loads_only_the_rest_plus_the_captain() {
        let mut prefs = CliExtensionPrefs::default();
        prefs.disabled_mcp.insert("noisy".into());
        let claude_json = serde_json::json!({
            "mcpServers": { "noisy": {"command": "a"}, "kept": {"command": "b"} },
            "projects": { "/repo": { "mcpServers": { "proj": {"command": "c"} } } }
        });
        let captain = r#"{"mcpServers":{"hivedeck":{"type":"http","url":"u"}}}"#;
        let args = claude_args_with(
            &prefs,
            &claude_json,
            Path::new("/repo"),
            Some(captain),
            &Map::new(),
        );
        assert!(args.contains(&"--strict-mcp-config".to_string()));
        let config = args
            .iter()
            .find_map(|a| a.strip_prefix("--mcp-config="))
            .unwrap();
        let v: Value = serde_json::from_str(config).unwrap();
        let names: BTreeSet<_> = v["mcpServers"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        assert_eq!(
            names,
            ["hivedeck", "kept", "proj"]
                .map(String::from)
                .into_iter()
                .collect()
        );
    }

    #[test]
    fn strict_config_preserves_run_overrides() {
        let mut prefs = CliExtensionPrefs::default();
        prefs.disabled_mcp.insert("probe".into());
        let installed = serde_json::json!({"mcpServers": {"probe": {"command": "old"}}});
        let run = r#"{"mcpServers":{"probe":{"command":"new"},"hivedeck":{"url":"local"},"other":{"command":"other"}}}"#;
        let args = claude_args_with(
            &prefs,
            &installed,
            Path::new("/repo"),
            Some(run),
            &Map::new(),
        );
        let config = args
            .iter()
            .find_map(|arg| arg.strip_prefix("--mcp-config="))
            .unwrap();
        let config: Value = serde_json::from_str(config).unwrap();
        assert!(args.contains(&"--strict-mcp-config".to_string()));
        assert_eq!(config["mcpServers"]["probe"]["command"], "new");
        assert!(config["mcpServers"].get("hivedeck").is_some());
        assert!(config["mcpServers"].get("other").is_some());
    }

    #[test]
    fn front_matter_reads_name_and_description() {
        let (name, desc) =
            front_matter("---\nname: impeccable\ndescription: \"Design.\"\n---\nbody");
        assert_eq!(name.as_deref(), Some("impeccable"));
        assert_eq!(desc.as_deref(), Some("Design."));
    }

    #[test]
    fn bundles_list_their_skills_with_a_prefix() {
        let root = std::env::temp_dir().join(format!("hd-skills-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("solo")).unwrap();
        std::fs::write(root.join("solo/SKILL.md"), "---\nname: solo\n---\n").unwrap();
        std::fs::create_dir_all(root.join("pack/skills/browser")).unwrap();
        std::fs::write(
            root.join("pack/skills/browser/SKILL.md"),
            "---\nname: browser\ndescription: Web.\n---\n",
        )
        .unwrap();
        let names: Vec<_> = skill_dirs(&root, "~", true)
            .into_iter()
            .map(|i| i.name)
            .collect();
        assert_eq!(names, vec!["pack:browser", "solo"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn gateway_aliases_map_to_claude_models() {
        let env: std::collections::HashMap<String, String> = [
            ("ANTHROPIC_DEFAULT_OPUS_MODEL", "planner"),
            ("ANTHROPIC_DEFAULT_FABLE_MODEL", "planner"),
            ("ANTHROPIC_DEFAULT_SONNET_MODEL", "coder"),
            ("ANTHROPIC_DEFAULT_HAIKU_MODEL", "fast"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        let o = gateway_model_overrides(Some("reviewer"), &env);
        assert_eq!(o["claude-opus-5-5"], "planner");
        assert!(o.get("claude-fable-5-2").is_none(), "one entry per alias");
        assert_eq!(o["claude-sonnet-5-5"], "coder");
        assert_eq!(o["claude-haiku-5-5"], "fast");
        // The run's own combo gets a free Claude ID of the same kind.
        assert_eq!(o["claude-opus-5"], "reviewer");
        // Real Claude IDs and aliases are left alone.
        let none =
            gateway_model_overrides(Some("claude-sonnet-5-5"), &std::collections::HashMap::new());
        assert!(none.is_empty());
    }

    #[test]
    fn codex_overrides_never_disable_the_captain_server() {
        let mut prefs = CliExtensionPrefs::default();
        prefs.disabled_mcp.insert("node_repl".into());
        prefs.disabled_mcp.insert("hivedeck".into());
        prefs
            .disabled_plugins
            .insert("codex-app-tools@openai-bundled".into());
        let overrides = codex_config_overrides(&prefs);
        assert_eq!(
            overrides,
            vec![
                (
                    "mcp_servers.node_repl.enabled".to_string(),
                    Value::Bool(false)
                ),
                (
                    "plugins.\"codex-app-tools@openai-bundled\".enabled".to_string(),
                    Value::Bool(false)
                ),
                ("features.apps".to_string(), Value::Bool(false)),
            ]
        );
    }
}
