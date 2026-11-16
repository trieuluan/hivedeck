//! Role-based combo suggestions (ADR-027).
//!
//! Scores every chat model 9router exposes for four agent roles, using the
//! model's capabilities (`/v1/models`), a name-based strength heuristic, and
//! the live quota/health of the provider connection behind it. Each role gets
//! a fallback chain of up to four models spread across providers, so one
//! exhausted provider never takes a role down. Pure functions; I/O lives in
//! the parent module.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    aliases::ALIASES,
    api::{Combo, Connection, Usage},
};

const CHAIN_LEN: usize = 4;
const MAX_PER_PROVIDER: usize = 2;
const EXHAUSTED_BELOW: f64 = 0.02;
const LOW_BELOW: f64 = 0.20;
/// A reviewer from the coder's own model family tends to miss the same
/// mistakes; push it down the chain.
const REVIEWER_SAME_FAMILY_PENALTY: f64 = 0.2;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ComboRole {
    /// Planning and orchestration: strongest reasoning, large context.
    Planner,
    /// Writing code: tool use, coding models, the most quota.
    Coder,
    /// Reviewing diffs: strong reasoning from a different model family.
    Reviewer,
    /// Titles, commit messages, summaries, compaction: fast and cheap.
    Fast,
}

impl ComboRole {
    pub const ALL: [ComboRole; 4] = [Self::Planner, Self::Coder, Self::Reviewer, Self::Fast];

    pub fn combo_name(self) -> &'static str {
        match self {
            Self::Planner => "planner",
            Self::Coder => "coder",
            Self::Reviewer => "reviewer",
            Self::Fast => "fast",
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderHealthStatus {
    Ok,
    /// Usable, but under 20% of its tightest quota window is left.
    Low,
    Exhausted,
    /// Credentials or connection test failing.
    Error,
    /// All connections disabled in 9router.
    Inactive,
    /// No quota data (provider has no usage API, or no connection record).
    Unknown,
}

impl ProviderHealthStatus {
    fn usable(self) -> bool {
        matches!(self, Self::Ok | Self::Low | Self::Unknown)
    }
}

#[derive(Clone, Debug, Serialize, TS)]
pub struct ProviderHealth {
    /// Provider id, e.g. `claude`.
    pub provider: String,
    /// Model-id prefix, e.g. `cc`.
    pub alias: String,
    pub status: ProviderHealthStatus,
    pub remaining_percent: Option<u8>,
    /// Name of the tightest quota window, e.g. `session (5h)`.
    pub quota_name: Option<String>,
    pub reset_at: Option<String>,
    /// Raw message from 9router or the provider (shown on demand).
    pub message: Option<String>,
    /// One-line, human summary of `message` (e.g. "API key expired").
    pub summary: Option<String>,
    pub model_count: usize,
}

#[derive(Clone, Debug, Serialize, TS)]
pub struct SuggestedModel {
    pub id: String,
    pub provider: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize, TS)]
pub struct RoleSuggestion {
    pub role: ComboRole,
    pub combo_name: String,
    pub models: Vec<SuggestedModel>,
    /// Models of an existing combo with the same name, if any.
    pub existing_models: Option<Vec<String>>,
    /// The existing combo already matches the suggestion.
    pub up_to_date: bool,
    /// HiveDeck changed this combo and can restore what it replaced.
    pub undo_available: bool,
}

#[derive(Clone, Debug, Serialize, TS)]
pub struct ComboSuggestions {
    pub roles: Vec<RoleSuggestion>,
    pub providers: Vec<ProviderHealth>,
    pub generated_at: String,
}

/// One entry of `/v1/models`.
#[derive(Clone, Debug, Default)]
pub struct ModelInfo {
    pub id: String,
    pub owned_by: String,
    pub tools: bool,
    pub reasoning: bool,
    pub context_window: Option<u64>,
}

/// Map a model-id prefix / `owned_by` alias to its provider id.
pub fn provider_for_alias(alias: &str) -> String {
    ALIASES
        .iter()
        .find(|(a, _)| *a == alias)
        .map(|(_, p)| p.to_string())
        .unwrap_or_else(|| alias.to_string())
}

/// Health of each provider from its connections and their usage.
pub fn provider_health(
    connections: &[(Connection, Option<Usage>)],
) -> HashMap<String, ProviderHealth> {
    let mut by_provider: HashMap<String, Vec<&(Connection, Option<Usage>)>> = HashMap::new();
    for entry in connections {
        by_provider
            .entry(entry.0.provider.clone())
            .or_default()
            .push(entry);
    }

    by_provider
        .into_iter()
        .map(|(provider, entries)| {
            let health = best_connection_health(&provider, &entries);
            (provider, health)
        })
        .collect()
}

fn connection_health(conn: &Connection, usage: Option<&Usage>) -> ProviderHealth {
    let mut h = ProviderHealth {
        provider: conn.provider.clone(),
        alias: String::new(),
        status: ProviderHealthStatus::Unknown,
        remaining_percent: None,
        quota_name: None,
        reset_at: None,
        message: None,
        summary: None,
        model_count: 0,
    };
    if !conn.is_active {
        h.status = ProviderHealthStatus::Inactive;
        return h;
    }
    if let Some(err) = &conn.error {
        h.status = ProviderHealthStatus::Error;
        h.summary = Some(summarize_message(err));
        h.message = Some(err.clone());
        return h;
    }
    let Some(usage) = usage else {
        return h;
    };
    if let Some(q) = usage.tightest() {
        h.remaining_percent = Some((q.remaining * 100.0).round() as u8);
        h.quota_name = Some(q.name.clone());
        h.reset_at = q.reset_at.clone();
        h.status = if q.remaining < EXHAUSTED_BELOW {
            ProviderHealthStatus::Exhausted
        } else if q.remaining < LOW_BELOW {
            ProviderHealthStatus::Low
        } else {
            ProviderHealthStatus::Ok
        };
    } else if let Some(msg) = &usage.message {
        // A message without quotas is either "no usage API" (fine) or a
        // credential failure (not fine).
        let lower = msg.to_lowercase();
        let failing = [
            "credential",
            "expired",
            "invalid",
            "unauthorized",
            "refresh",
            "attention",
        ]
        .iter()
        .any(|w| lower.contains(w));
        if failing {
            h.status = ProviderHealthStatus::Error;
        }
        h.summary = Some(summarize_message(msg));
        h.message = Some(msg.clone());
    }
    h
}

/// Turn a raw provider/9router error into one short line.
pub fn summarize_message(raw: &str) -> String {
    let lower = raw.to_lowercase();
    let known = [
        (
            &["api_key_expired", "key has expired", "key expired"][..],
            "API key expired",
        ),
        (
            &["invalid_grant", "refresh token"][..],
            "Sign-in expired — reconnect",
        ),
        (
            &["credential", "unauthorized", "401", "403", "forbidden"][..],
            "Credentials rejected",
        ),
        (
            &["rate limit", "rate_limit", "429", "too many requests"][..],
            "Rate limited",
        ),
        (
            &["quota", "exceeded", "insufficient", "allowance"][..],
            "Quota exhausted",
        ),
        (
            &["usage not available", "unable to fetch usage", "no usage"][..],
            "Usage not reported",
        ),
        (
            &["timeout", "timed out", "econn", "network"][..],
            "Provider unreachable",
        ),
    ];
    if let Some((_, label)) = known
        .iter()
        .find(|(needles, _)| needles.iter().any(|n| lower.contains(n)))
    {
        return (*label).to_string();
    }
    // Prefer a "message" field from an embedded JSON body.
    let text = raw
        .find('{')
        .and_then(|i| serde_json::from_str::<serde_json::Value>(&raw[i..]).ok())
        .and_then(|v| {
            v.pointer("/error/message")
                .or_else(|| v.get("message"))
                .and_then(|m| m.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| raw.to_string());
    let first = text.split(['.', '\n']).next().unwrap_or(&text).trim();
    if first.chars().count() > 60 {
        format!("{}…", first.chars().take(57).collect::<String>())
    } else {
        first.to_string()
    }
}

fn rank(status: ProviderHealthStatus) -> u8 {
    match status {
        ProviderHealthStatus::Ok => 5,
        ProviderHealthStatus::Unknown => 4,
        ProviderHealthStatus::Low => 3,
        ProviderHealthStatus::Exhausted => 2,
        ProviderHealthStatus::Error => 1,
        ProviderHealthStatus::Inactive => 0,
    }
}

/// With several connections (accounts) for one provider, 9router rotates
/// between them, so the provider is as healthy as its best connection.
fn best_connection_health(
    provider: &str,
    entries: &[&(Connection, Option<Usage>)],
) -> ProviderHealth {
    entries
        .iter()
        .map(|(c, u)| connection_health(c, u.as_ref()))
        .max_by(|a, b| {
            rank(a.status)
                .cmp(&rank(b.status))
                .then(a.remaining_percent.cmp(&b.remaining_percent))
        })
        .unwrap_or_else(|| ProviderHealth {
            provider: provider.to_string(),
            alias: String::new(),
            status: ProviderHealthStatus::Unknown,
            remaining_percent: None,
            quota_name: None,
            reset_at: None,
            message: None,
            summary: None,
            model_count: 0,
        })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Tier {
    Frontier,
    Strong,
    Fast,
    Unknown,
}

/// Reasoning-effort suffix 9router appends to model variants.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Effort {
    Low,
    Medium,
    High,
}

const FAST_TOKENS: &[&str] = &[
    "haiku", "flash", "mini", "nano", "lite", "small", "tiny", "fast", "instant", "air", "spark",
];
const FRONTIER_TOKENS: &[&str] = &["opus", "fable", "pro", "ultra", "max", "o3", "o4"];
const STRONG_TOKENS: &[&str] = &[
    "sonnet", "codex", "coder", "code", "kimi", "glm", "qwen", "deepseek", "minimax", "mimo",
    "grok", "gemini", "gpt", "llama", "mistral", "devstral", "nemotron", "claude",
];
const CODING_TOKENS: &[&str] = &["codex", "coder", "code", "devstral"];
const GOOD_AT_CODE_TOKENS: &[&str] = &[
    "sonnet", "opus", "fable", "kimi", "glm", "gpt", "qwen", "deepseek", "minimax", "claude",
];
const UNSTABLE_TOKENS: &[&str] = &["preview", "alpha", "exp", "experimental", "auto", "reserve"];

/// Parsed model name: `cx/gpt-5.6-luna-review[1m]` →
/// tokens `gpt 5 6 luna`, review, 1M context.
#[derive(Clone, Debug)]
struct ModelName {
    /// Base name without effort/review/[1m] markers, e.g. `gpt-5.6-luna`.
    base: String,
    tokens: Vec<String>,
    effort: Option<Effort>,
    thinking: bool,
    review: bool,
    long_context: bool,
    /// Numeric version parts, e.g. `[5, 6]` (dates and sizes dropped).
    version: Vec<u32>,
    /// Non-numeric tokens of `base` (`claude-opus`): the model line versions
    /// are compared within.
    line: String,
}

fn split_tokens(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    for raw in s.split(|c: char| !c.is_ascii_alphanumeric()) {
        if raw.is_empty() {
            continue;
        }
        // Split letter/digit boundaries ("qwen3" → "qwen", "3"; "k2" → "k", "2")
        // but keep size tokens like "120b" whole.
        if raw.ends_with('b') && raw[..raw.len() - 1].chars().all(|c| c.is_ascii_digit()) {
            out.push(raw.to_string());
            continue;
        }
        let mut cur = String::new();
        let mut prev_digit = None;
        for ch in raw.chars() {
            let is_digit = ch.is_ascii_digit();
            if prev_digit.is_some_and(|p| p != is_digit) && !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            cur.push(ch);
            prev_digit = Some(is_digit);
        }
        if !cur.is_empty() {
            out.push(cur);
        }
    }
    out
}

fn parse_name(id: &str) -> ModelName {
    let full = id.rsplit('/').next().unwrap_or(id).to_lowercase();
    let long_context = full.contains("[1m]");
    let mut base = full.replace("[1m]", "");
    let mut effort = None;
    let mut thinking = false;
    let mut review = false;
    // Strip trailing markers: `-high`, `-thinking`, `-review` (any order).
    while let Some((head, tail)) = base.clone().rsplit_once('-') {
        let marker = match tail {
            "none" | "minimal" | "low" => Some(Some(Effort::Low)),
            "medium" => Some(Some(Effort::Medium)),
            "high" | "xhigh" => Some(Some(Effort::High)),
            "thinking" => {
                thinking = true;
                Some(None)
            }
            "review" => {
                review = true;
                Some(None)
            }
            _ => None,
        };
        let Some(e) = marker else {
            break;
        };
        if effort.is_none() {
            effort = e;
        }
        base = head.to_string();
    }
    let tokens = split_tokens(&base);
    let version = tokens
        .iter()
        .filter_map(|t| t.parse::<u32>().ok())
        .filter(|n| *n < 1000)
        .collect();
    let line = tokens
        .iter()
        .filter(|t| !t.chars().all(|c| c.is_ascii_digit()))
        .cloned()
        .collect::<Vec<_>>()
        .join("-");
    ModelName {
        base,
        tokens,
        effort,
        thinking,
        review,
        long_context,
        version,
        line,
    }
}

impl ModelName {
    fn has(&self, set: &[&str]) -> bool {
        self.tokens.iter().any(|t| set.contains(&t.as_str()))
    }

    /// Model size from a token like `120b`, in billions.
    fn size_b(&self) -> Option<u32> {
        self.tokens
            .iter()
            .find_map(|t| t.strip_suffix('b').and_then(|n| n.parse().ok()))
    }

    fn tier(&self) -> Tier {
        if self.has(FAST_TOKENS) || self.size_b().is_some_and(|b| b <= 32) {
            Tier::Fast
        } else if self.has(FRONTIER_TOKENS)
            || self.thinking
            || (self.has(&["gpt"]) && self.version.first().is_some_and(|v| *v >= 5))
        {
            Tier::Frontier
        } else if self.has(STRONG_TOKENS) || self.size_b().is_some_and(|b| b >= 100) {
            Tier::Strong
        } else {
            Tier::Unknown
        }
    }

    fn family(&self, provider: &str) -> String {
        [
            (
                &["claude", "opus", "sonnet", "haiku", "fable"][..],
                "anthropic",
            ),
            (&["gpt", "codex", "o3", "o4"][..], "openai"),
            (&["gemini"][..], "google"),
            (&["grok"][..], "xai"),
            (&["kimi"][..], "moonshot"),
            (&["glm"][..], "zhipu"),
            (&["qwen"][..], "qwen"),
            (&["deepseek"][..], "deepseek"),
            (&["minimax"][..], "minimax"),
            (&["mimo"][..], "xiaomi"),
        ]
        .iter()
        .find(|(needles, _)| self.has(needles))
        .map(|(_, f)| f.to_string())
        .unwrap_or_else(|| provider.to_string())
    }
}

/// For each model line, 1.0 for the newest version, then 0.6, then 0.3.
fn recency_scores(names: &[&ModelName]) -> HashMap<String, f64> {
    let mut by_line: HashMap<&str, Vec<&Vec<u32>>> = HashMap::new();
    for n in names {
        by_line.entry(&n.line).or_default().push(&n.version);
    }
    let mut out = HashMap::new();
    for n in names {
        let versions = &by_line[n.line.as_str()];
        let newer = versions
            .iter()
            .filter(|v| v.as_slice() > n.version.as_slice())
            .map(|v| v.as_slice())
            .collect::<std::collections::HashSet<_>>()
            .len();
        let score = match newer {
            0 => 1.0,
            1 => 0.6,
            _ => 0.3,
        };
        out.insert(n.base.clone(), score);
    }
    out
}

fn is_chat_model(m: &ModelInfo) -> bool {
    if m.owned_by == "combo" {
        return false;
    }
    let n = parse_name(&m.id);
    !n.has(&[
        "embed",
        "embedding",
        "tts",
        "whisper",
        "transcribe",
        "image",
        "imagen",
        "dall",
        "veo",
        "rerank",
        "moderation",
        "audio",
        "speech",
        "music",
        "vision",
    ])
}

struct Candidate<'a> {
    model: &'a ModelInfo,
    name: ModelName,
    provider: String,
    family: String,
    tier: Tier,
    recency: f64,
    health: Option<&'a ProviderHealth>,
}

impl Candidate<'_> {
    /// Model strength for a role. Coding agents loop for a long time, so the
    /// coder prefers strong mid-tier models over the slowest frontier ones.
    fn strength(&self, role: ComboRole) -> f64 {
        let tier = match (role, self.tier) {
            (ComboRole::Coder, Tier::Strong) => 1.0,
            (ComboRole::Coder, Tier::Frontier) => 0.85,
            (_, Tier::Frontier) => 1.0,
            (_, Tier::Strong) => 0.75,
            (_, Tier::Unknown) => 0.45,
            (_, Tier::Fast) => 0.35,
        };
        let unstable = if self.name.has(UNSTABLE_TOKENS) {
            0.15
        } else {
            0.0
        };
        0.8 * tier + 0.2 * self.recency - unstable
    }

    fn speed(&self) -> f64 {
        match self.tier {
            Tier::Fast => 1.0,
            Tier::Unknown => 0.5,
            Tier::Strong => 0.4,
            Tier::Frontier => 0.1,
        }
    }

    fn coding(&self) -> f64 {
        if self.name.has(CODING_TOKENS) {
            1.0
        } else if self.name.has(GOOD_AT_CODE_TOKENS) {
            0.7
        } else {
            0.4
        }
    }

    fn context(&self) -> f64 {
        if self.name.long_context {
            return 1.0;
        }
        match self.model.context_window {
            Some(c) if c >= 200_000 => 1.0,
            Some(c) if c >= 128_000 => 0.7,
            Some(_) => 0.4,
            None => 0.5,
        }
    }

    fn quota(&self) -> f64 {
        match self.health {
            Some(h) => match (h.status, h.remaining_percent) {
                (ProviderHealthStatus::Ok, Some(p)) => 0.4 + 0.6 * f64::from(p) / 100.0,
                (ProviderHealthStatus::Low, Some(p)) => 0.2 + 0.5 * f64::from(p) / 100.0,
                _ => 0.6,
            },
            None => 0.6,
        }
    }

    /// Bonus for the reasoning-effort variant that suits the role.
    fn effort_fit(&self, role: ComboRole) -> f64 {
        let effort = if self.name.thinking {
            Some(Effort::High)
        } else {
            self.name.effort
        };
        match (role, effort) {
            (ComboRole::Planner, Some(Effort::High)) => 0.08,
            (ComboRole::Planner, Some(Effort::Low)) => -0.06,
            (ComboRole::Coder, Some(Effort::Medium | Effort::High)) => 0.04,
            (ComboRole::Coder, Some(Effort::Low)) => -0.04,
            (ComboRole::Reviewer, Some(Effort::High)) => 0.06,
            (ComboRole::Reviewer, Some(Effort::Low)) => -0.06,
            (ComboRole::Fast, Some(Effort::Low)) => 0.08,
            (ComboRole::Fast, Some(Effort::High)) => -0.1,
            _ => 0.0,
        }
    }

    fn eligible(&self, role: ComboRole) -> bool {
        let m = self.model;
        // `-review` variants are tuned for code review only.
        if self.name.review && role != ComboRole::Reviewer {
            return false;
        }
        match role {
            ComboRole::Planner => m.tools && (m.reasoning || self.tier == Tier::Frontier),
            ComboRole::Coder => m.tools && self.tier != Tier::Fast,
            ComboRole::Fast => m.tools,
            ComboRole::Reviewer => {
                m.reasoning || matches!(self.tier, Tier::Frontier | Tier::Strong)
            }
        }
    }

    fn score(&self, role: ComboRole) -> f64 {
        let reasoning = if self.model.reasoning { 1.0 } else { 0.0 };
        let s = self.strength(role);
        let base = match role {
            ComboRole::Planner => {
                // Generalists plan better than coding specialists.
                let specialist = if self.name.has(CODING_TOKENS) {
                    0.08
                } else {
                    0.0
                };
                0.45 * s + 0.15 * reasoning + 0.15 * self.context() + 0.15 * self.quota()
                    - specialist
            }
            ComboRole::Coder => {
                0.25 * s + 0.35 * self.coding() + 0.3 * self.quota() + 0.1 * reasoning
            }
            ComboRole::Reviewer => {
                0.4 * s
                    + 0.15 * self.context()
                    + 0.2 * self.quota()
                    + 0.15 * self.coding()
                    + 0.1 * reasoning
                    + if self.name.review { 0.06 } else { 0.0 }
            }
            ComboRole::Fast => 0.5 * self.speed() + 0.3 * self.quota() + 0.15 * self.recency + 0.05,
        };
        base + self.effort_fit(role)
    }

    fn reason(&self) -> String {
        let mut parts = vec![
            match self.tier {
                Tier::Frontier => "frontier",
                Tier::Strong => "strong",
                Tier::Fast => "fast",
                Tier::Unknown => "general",
            }
            .to_string(),
        ];
        if self.name.has(CODING_TOKENS) {
            parts.push("coding".into());
        }
        let effort = if self.name.thinking {
            Some(Effort::High)
        } else {
            self.name.effort
        };
        match (self.model.reasoning, effort) {
            (true, Some(Effort::Low)) => parts.push("light reasoning".into()),
            (true, Some(Effort::High)) => parts.push("deep reasoning".into()),
            (true, _) => parts.push("reasoning".into()),
            (false, _) => {}
        }
        if self.name.review {
            parts.push("review mode".into());
        }
        if self.name.long_context {
            parts.push("1M ctx".into());
        } else if let Some(c) = self.model.context_window {
            parts.push(format!("{}k ctx", c / 1000));
        }
        match self.health.and_then(|h| h.remaining_percent) {
            Some(p) => parts.push(format!("quota {p}%")),
            None => parts.push("no quota data".into()),
        }
        parts.join(" · ")
    }
}

/// Build a fallback chain: best first, spread across providers (a provider
/// appears at most twice and only after every other usable provider had a
/// chance), one variant per model.
fn chain(ranked: &[(f64, &Candidate<'_>)]) -> Vec<SuggestedModel> {
    let mut picks: Vec<&Candidate<'_>> = Vec::new();
    for distinct_pass in [true, false] {
        for (_, c) in ranked {
            if picks.len() >= CHAIN_LEN {
                break;
            }
            if picks
                .iter()
                .any(|p| p.provider == c.provider && p.name.base == c.name.base)
            {
                continue;
            }
            let same_provider = picks.iter().filter(|p| p.provider == c.provider).count();
            if (distinct_pass && same_provider > 0) || same_provider >= MAX_PER_PROVIDER {
                continue;
            }
            picks.push(c);
        }
    }
    picks
        .into_iter()
        .map(|c| SuggestedModel {
            id: c.model.id.clone(),
            provider: c.provider.clone(),
            reason: c.reason(),
        })
        .collect()
}

pub fn suggest(
    models: &[ModelInfo],
    health: &HashMap<String, ProviderHealth>,
    existing: &[Combo],
) -> Vec<RoleSuggestion> {
    let usable: Vec<(&ModelInfo, ModelName, String)> = models
        .iter()
        .filter(|m| is_chat_model(m))
        .filter_map(|m| {
            let provider = provider_for_alias(&m.owned_by);
            if health.get(&provider).is_some_and(|h| !h.status.usable()) {
                return None;
            }
            Some((m, parse_name(&m.id), provider))
        })
        .collect();
    let recency = recency_scores(&usable.iter().map(|(_, n, _)| n).collect::<Vec<_>>());
    let candidates: Vec<Candidate<'_>> = usable
        .into_iter()
        .map(|(m, name, provider)| Candidate {
            model: m,
            family: name.family(&provider),
            tier: name.tier(),
            recency: recency.get(&name.base).copied().unwrap_or(1.0),
            health: health.get(&provider),
            name,
            provider,
        })
        .collect();

    let mut coder_family: Option<String> = None;
    let mut out = Vec::new();
    // Coder first so the reviewer can prefer a different family.
    let order = [
        ComboRole::Coder,
        ComboRole::Planner,
        ComboRole::Reviewer,
        ComboRole::Fast,
    ];
    for role in order {
        let mut ranked: Vec<(f64, &Candidate<'_>)> = candidates
            .iter()
            .filter(|c| c.eligible(role))
            .map(|c| {
                let mut s = c.score(role);
                if role == ComboRole::Reviewer && coder_family.as_deref() == Some(&c.family) {
                    s -= REVIEWER_SAME_FAMILY_PENALTY;
                }
                (s, c)
            })
            .collect();
        ranked.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.model.id.cmp(&b.1.model.id)));
        let models = chain(&ranked);
        if role == ComboRole::Coder {
            coder_family = ranked.first().map(|(_, c)| c.family.clone());
        }

        let name = role.combo_name();
        let existing_models = existing
            .iter()
            .find(|c| c.name == name)
            .map(|c| c.models.clone());
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        let up_to_date = existing_models
            .as_ref()
            .is_some_and(|e| e.iter().map(String::as_str).eq(ids.iter().copied()));
        out.push(RoleSuggestion {
            role,
            combo_name: name.to_string(),
            models,
            existing_models,
            up_to_date,
            undo_available: false,
        });
    }
    out.sort_by_key(|r| ComboRole::ALL.iter().position(|x| *x == r.role));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::nine_router::api::Quota;

    fn model(id: &str, owned_by: &str, tools: bool, reasoning: bool, ctx: u64) -> ModelInfo {
        ModelInfo {
            id: id.to_string(),
            owned_by: owned_by.to_string(),
            tools,
            reasoning,
            context_window: Some(ctx),
        }
    }

    fn conn(provider: &str, active: bool, error: Option<&str>) -> Connection {
        Connection {
            id: format!("{provider}-1"),
            provider: provider.to_string(),
            name: None,
            auth_type: Some("oauth".into()),
            is_active: active,
            error: error.map(str::to_string),
        }
    }

    fn usage(remaining: f64) -> Usage {
        Usage {
            quotas: vec![Quota {
                name: "session (5h)".into(),
                remaining,
                reset_at: None,
            }],
            message: None,
        }
    }

    fn catalog() -> Vec<ModelInfo> {
        vec![
            model("cc/claude-opus-5", "cc", true, true, 200_000),
            model("cc/claude-sonnet-5", "cc", true, true, 200_000),
            model("cc/claude-haiku-4-5", "cc", true, false, 200_000),
            model("cx/gpt-5.2-codex", "cx", true, true, 272_000),
            model("cx/gpt-5.2", "cx", true, true, 272_000),
            model("cx/gpt-5-mini", "cx", true, false, 128_000),
            model("ag/gemini-3-pro", "ag", true, true, 1_000_000),
            model("ag/gemini-3-flash", "ag", true, false, 1_000_000),
            model("ollama/gpt-oss:120b", "ollama", true, true, 128_000),
            model("cx/gpt-5.2-codex-high", "cx", true, true, 272_000),
            model("cx/gpt-5.2-review", "cx", true, true, 272_000),
            model("ollama/nomic-embed-text", "ollama", false, false, 8_000),
            model("planner", "combo", true, true, 200_000),
        ]
    }

    #[test]
    fn summarizes_provider_errors() {
        let raw = r#"[401]: {"error":{"type":"authentication_error","code":"api_key_expired","message":"This API key has expired. Create a new one."}}"#;
        assert_eq!(summarize_message(raw), "API key expired");
        assert_eq!(
            summarize_message("Refresh token not found or invalid"),
            "Sign-in expired — reconnect"
        );
        assert_eq!(
            summarize_message(r#"{"error":{"message":"Model is warming up. Try later"}}"#),
            "Model is warming up"
        );
    }

    #[test]
    fn maps_aliases_to_providers() {
        assert_eq!(provider_for_alias("cc"), "claude");
        assert_eq!(provider_for_alias("cx"), "codex");
        assert_eq!(provider_for_alias("ocg"), "opencode-go");
        assert_eq!(provider_for_alias("ollama"), "ollama");
    }

    fn tier(id: &str) -> Tier {
        parse_name(id).tier()
    }

    #[test]
    fn classifies_tiers() {
        assert_eq!(tier("cc/claude-opus-5"), Tier::Frontier);
        assert_eq!(tier("cc/claude-fable-5-2"), Tier::Frontier);
        assert_eq!(tier("cc/claude-haiku-4-5"), Tier::Fast);
        assert_eq!(tier("cx/gpt-5-mini"), Tier::Fast);
        // "gemini" must not match the "mini" fast token.
        assert_eq!(tier("ag/gemini-3.1-pro-high"), Tier::Frontier);
        assert_eq!(tier("ag/gemini-3.8-flash"), Tier::Fast);
        assert_eq!(tier("ag/gemini-4-argon-medium"), Tier::Strong);
        assert_eq!(tier("cc/claude-sonnet-5"), Tier::Strong);
        assert_eq!(tier("cx/gpt-6-astra"), Tier::Frontier);
        assert_eq!(tier("ollama/gpt-oss:120b"), Tier::Strong);
        assert_eq!(tier("ocg/kimi-k2.7-code"), Tier::Strong);
        assert_eq!(tier("oc/union-alpha"), Tier::Unknown);
    }

    #[test]
    fn parses_variant_markers() {
        let n = parse_name("cx/gpt-5.6-luna-review[1m]");
        assert_eq!(n.base, "gpt-5.6-luna");
        assert!(n.review && n.long_context);
        assert_eq!(n.version, vec![5, 6]);
        let h = parse_name("ag/claude-opus-5-5-high");
        assert_eq!(h.base, "claude-opus-5-5");
        assert_eq!(h.effort, Some(Effort::High));
        let d = parse_name("cc/claude-haiku-4-5-20251001");
        assert_eq!(d.version, vec![4, 5]);
        assert!(parse_name("ag/claude-opus-4-6-thinking").thinking);
    }

    #[test]
    fn prefers_newer_versions_in_a_line() {
        let names = [
            parse_name("cc/claude-opus-5"),
            parse_name("cc/claude-opus-5-5"),
            parse_name("ag/claude-opus-4-6"),
        ];
        let refs: Vec<&ModelName> = names.iter().collect();
        let r = recency_scores(&refs);
        assert_eq!(r["claude-opus-5-5"], 1.0);
        assert!(r["claude-opus-5"] < 1.0);
        assert!(r["claude-opus-4-6"] < r["claude-opus-5"]);
    }

    #[test]
    fn broken_provider_is_excluded_everywhere() {
        let health = provider_health(&[
            (conn("claude", true, Some("invalid_grant")), None),
            (conn("codex", true, None), Some(usage(0.8))),
            (conn("antigravity", true, None), Some(usage(0.5))),
        ]);
        assert_eq!(health["claude"].status, ProviderHealthStatus::Error);
        let roles = suggest(&catalog(), &health, &[]);
        for r in &roles {
            assert!(
                r.models.iter().all(|m| m.provider != "claude"),
                "{:?}",
                r.models
            );
            assert!(!r.models.is_empty());
        }
    }

    #[test]
    fn chains_spread_across_providers_and_skip_non_chat() {
        let health = provider_health(&[
            (conn("claude", true, None), Some(usage(0.9))),
            (conn("codex", true, None), Some(usage(0.9))),
            (conn("antigravity", true, None), Some(usage(0.9))),
        ]);
        let roles = suggest(&catalog(), &health, &[]);
        assert_eq!(
            roles.iter().map(|r| r.role).collect::<Vec<_>>(),
            ComboRole::ALL.to_vec()
        );
        for r in &roles {
            assert!(r.models.len() <= CHAIN_LEN);
            // First three picks come from three different providers.
            let firsts: Vec<_> = r.models.iter().take(3).map(|m| &m.provider).collect();
            let mut uniq = firsts.clone();
            uniq.dedup();
            assert_eq!(firsts.len(), uniq.len(), "{:?}", r.models);
            assert!(r.models.iter().all(|m| !m.id.contains("embed")));
            assert!(r.models.iter().all(|m| m.id != "planner"));
        }
        let fast = &roles[3];
        assert!(
            ["haiku", "mini", "flash"]
                .iter()
                .any(|n| fast.models[0].id.contains(n)),
            "{:?}",
            fast.models
        );
        let planner = &roles[0];
        assert_eq!(tier(&planner.models[0].id), Tier::Frontier);
        // Coder leads with a coding model; review variants stay out of it.
        let coder = &roles[1];
        assert!(coder.models[0].id.contains("codex"), "{:?}", coder.models);
        assert!(
            roles[..2]
                .iter()
                .chain(&roles[3..])
                .all(|r| r.models.iter().all(|m| !m.id.contains("review")))
        );
        // Reviewer avoids the coder's model family at the top.
        let reviewer = &roles[2];
        assert!(
            !reviewer.models[0].id.starts_with("cx/"),
            "{:?}",
            reviewer.models
        );
        // Roles are not all the same chain.
        assert_ne!(planner.models[0].id, coder.models[0].id);
    }

    #[test]
    fn exhausted_and_low_quota_change_ranking() {
        let health = provider_health(&[
            (conn("claude", true, None), Some(usage(0.01))),
            (conn("codex", true, None), Some(usage(0.9))),
        ]);
        assert_eq!(health["claude"].status, ProviderHealthStatus::Exhausted);
        let roles = suggest(&catalog(), &health, &[]);
        assert!(roles[1].models.iter().all(|m| m.provider != "claude"));
    }

    #[test]
    fn best_connection_wins_for_multi_account_providers() {
        let mut second = conn("codex", true, None);
        second.id = "codex-2".into();
        let health = provider_health(&[
            (conn("codex", true, None), Some(usage(0.01))),
            (second, Some(usage(0.7))),
        ]);
        assert_eq!(health["codex"].status, ProviderHealthStatus::Ok);
        assert_eq!(health["codex"].remaining_percent, Some(70));
    }

    #[test]
    fn marks_up_to_date_existing_combos() {
        let health = HashMap::new();
        let first = suggest(&catalog(), &health, &[]);
        let coder = first.iter().find(|r| r.role == ComboRole::Coder).unwrap();
        let existing = vec![Combo {
            id: "1".into(),
            name: "coder".into(),
            models: coder.models.iter().map(|m| m.id.clone()).collect(),
            kind: None,
        }];
        let again = suggest(&catalog(), &health, &existing);
        let coder = again.iter().find(|r| r.role == ComboRole::Coder).unwrap();
        assert!(coder.up_to_date);
        let planner = again.iter().find(|r| r.role == ComboRole::Planner).unwrap();
        assert!(planner.existing_models.is_none() && !planner.up_to_date);
    }
}
