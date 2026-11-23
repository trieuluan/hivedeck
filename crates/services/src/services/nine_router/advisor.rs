//! Role-based combo suggestions (ADR-027).
//!
//! Scores every chat model 9router exposes for four agent roles, using the
//! model's capabilities (`/v1/models`), a name-based strength heuristic, and
//! the live quota/health of the provider connection behind it. Each role gets
//! a three-part fallback chain (ADR-039): primary models from every healthy
//! subscription/free provider, then standby models from providers that are
//! only out until their quota resets, then a pay-as-you-go backup that never
//! runs out. Pure functions; I/O lives in the parent module.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    aliases::ALIASES,
    api::{Combo, Connection, ModelLock, Usage},
};

/// Primary models: healthy providers, best first.
const PRIMARY_LEN: usize = 5;
/// Standby models: one per provider that is out until its quota resets.
const STANDBY_LEN: usize = 3;
/// Pay-as-you-go backups at the very end.
const BACKUP_LEN: usize = 2;
const MAX_PER_PROVIDER: usize = 2;
/// Providers billed per token from a prepaid balance: always available while
/// the balance lasts, so they belong at the end of every chain.
pub const PAY_AS_YOU_GO_PROVIDERS: &[&str] = &["deepseek", "openrouter", "gemini"];
/// The cheapest pay-as-you-go provider with the best caching: always last.
const LAST_RESORT_PROVIDER: &str = "deepseek";
/// A model already heading another role's combo is pushed down, and so is
/// its provider (one quota pool), so roles start on different models and
/// pools (ADR-041).
const SAME_HEAD_PENALTY: f64 = 0.3;
const SAME_HEAD_POOL_PENALTY: f64 = 0.12;
/// Frontier models too slow for an agent loop (tens of seconds per call).
const SLOW_TOKENS: &[&str] = &["carbon"];
/// Free models are rate-limited and change often; rank them lower.
const FREE_PENALTY: f64 = 0.12;
/// Free models in a chain's primary part, at most.
const MAX_FREE: usize = 1;
/// Legacy aliases that now point at another model (e.g. `deepseek-reasoner`).
const LEGACY_TOKENS: &[&str] = &["reasoner", "chat"];
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
    /// Out of quota right now (usage or rate limit); comes back on reset.
    Limited,
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

    /// Out only until a quota window resets.
    fn temporary(self) -> bool {
        matches!(self, Self::Limited | Self::Exhausted)
    }
}

/// How a provider is paid for.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderBilling {
    /// A plan with usage windows (5h / weekly / monthly).
    Subscription,
    /// Per token from a prepaid balance.
    PayAsYouGo,
    /// Free models, rate-limited.
    Free,
    Unknown,
}

/// One usage window of a provider, e.g. `weekly (7d)` at 61%.
#[derive(Clone, Debug, Serialize, TS)]
pub struct QuotaWindow {
    pub name: String,
    pub remaining_percent: u8,
    pub reset_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_amount: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
}

/// Where a model sits in a combo's fallback chain.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChainSlot {
    Primary,
    /// Its provider is out until a reset; kept so it comes back on its own.
    Standby,
    /// Pay-as-you-go, last resort.
    Backup,
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
    pub billing: ProviderBilling,
    /// Every usage window, shortest first (5h, daily, weekly, monthly…).
    pub quotas: Vec<QuotaWindow>,
    /// For a limited provider: which window ran out, e.g. `weekly`.
    pub limit_window: Option<String>,
    /// For a limited provider: when it comes back, as the provider said it
    /// (e.g. `4d 13h`), when no exact time is known.
    pub resets_in: Option<String>,
    /// What 9router recorded and priced for this provider (ADR-042).
    pub spend: Option<ProviderSpend>,
}

/// Recent use of a provider as 9router recorded it. Costs are 9router's
/// estimate from its pricing table, not the provider's bill.
#[derive(Clone, Debug, Default, Serialize, TS)]
pub struct ProviderSpend {
    pub today_requests: u64,
    pub today_usd: f64,
    pub month_requests: u64,
    /// Last 30 days.
    pub month_usd: f64,
    /// Tokens in the last 30 days (input + output), for providers 9router
    /// has no price for.
    pub month_tokens: u64,
    /// 9router had a price for this provider's models (some cost > 0).
    pub priced: bool,
}

impl ProviderHealth {
    pub fn unknown(provider: &str) -> Self {
        Self {
            provider: provider.to_string(),
            alias: String::new(),
            status: ProviderHealthStatus::Unknown,
            remaining_percent: None,
            quota_name: None,
            reset_at: None,
            message: None,
            summary: None,
            model_count: 0,
            billing: ProviderBilling::Unknown,
            quotas: Vec::new(),
            limit_window: None,
            resets_in: None,
            spend: None,
        }
    }

    /// Decide how the provider is paid for, from its name and quota windows.
    pub fn classify_billing(&mut self) {
        let named = |w: &str| self.provider.contains(w);
        let balance = self.quotas.iter().any(|q| {
            let n = q.name.to_lowercase();
            n.contains("balance") || n.contains("credit")
        });
        self.billing = if is_pay_as_you_go(&self.provider) || balance {
            ProviderBilling::PayAsYouGo
        } else if named("free") {
            ProviderBilling::Free
        } else if !self.quotas.is_empty() || self.status.temporary() {
            ProviderBilling::Subscription
        } else {
            ProviderBilling::Unknown
        };
    }
}

/// Why a free model can't serve agents (shown in the excluded list).
pub const AGENT_BLOCKED_FREE: &str = "Free model: OpenCode app only";

/// Models that answer a tiny test request but refuse real agent requests
/// (tools, long prompts) from outside their own app, so they would only
/// add a failing hop to every fallback (ADR-040). OpenCode reached without
/// a key (9router's public account) serves only its free models, and those
/// return `FreeUsageLimitError` to Claude Code and Codex.
pub fn agent_blocked(id: &str, provider: &str, has_key: bool) -> Option<&'static str> {
    (provider == "opencode" && (!has_key || id.ends_with("-free"))).then_some(AGENT_BLOCKED_FREE)
}

/// Out for longer than a rate-limit window: exhausted, or a usage limit that
/// resets in days. A short rate limit keeps a model where it is; 9router
/// skips it for a moment and comes back to it.
fn long_outage(h: &ProviderHealth) -> bool {
    match h.status {
        ProviderHealthStatus::Exhausted => true,
        ProviderHealthStatus::Limited => {
            matches!(h.limit_window.as_deref(), Some("weekly" | "monthly"))
                || h.resets_in.as_deref().is_some_and(|r| r.contains('d'))
        }
        _ => false,
    }
}

pub fn is_pay_as_you_go(provider: &str) -> bool {
    PAY_AS_YOU_GO_PROVIDERS.contains(&provider)
}

/// Sort key for quota windows: shortest window first.
fn window_order(name: &str) -> u8 {
    let n = name.to_lowercase();
    if n.contains("5h") || n.contains("session") || n.contains("hour") {
        0
    } else if n.contains("day") || n.contains("daily") || n.contains("24h") {
        1
    } else if n.contains("week") || n.contains("7d") {
        2
    } else if n.contains("month") || n.contains("30d") {
        3
    } else {
        4
    }
}

/// A usage/rate limit that ends on its own (as opposed to bad credentials or
/// an empty balance).
pub fn is_temporary_limit(raw: &str) -> bool {
    let lower = raw.to_lowercase();
    let billing = [
        "insufficient balance",
        "402",
        "add usage credits",
        "payment",
        "credits_required",
        "usage credits are required",
        "free usage limit reached",
        "freeusagelimiterror",
    ];
    if billing.iter().any(|w| lower.contains(w)) {
        return false;
    }
    [
        "429",
        "usage limit",
        "rate limit",
        "rate_limit",
        "too many requests",
        "resets in",
    ]
    .iter()
    .any(|w| lower.contains(w))
}

/// `(weekly, resets in 4d 13h)` → (`weekly`, `4d 13h`).
pub fn parse_limit_note(raw: &str) -> (Option<String>, Option<String>) {
    let lower = raw.to_lowercase();
    // Longest windows first, and no bare "5h": it also appears in the
    // reset time itself ("resets in 4d 5h").
    let window = ["monthly", "weekly", "daily", "5-hour", "hourly"]
        .iter()
        .find(|w| lower.contains(*w))
        .map(|w| w.to_string());
    let resets = lower.find("resets in ").map(|i| {
        lower[i + "resets in ".len()..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == ' ')
            .collect::<String>()
            .trim()
            .to_string()
    });
    (window, resets.filter(|r| !r.is_empty()))
}

fn parse_reset_duration(raw: &str) -> Option<chrono::Duration> {
    let mut total_secs: i64 = 0;
    let mut matched = false;
    for token in raw.split_whitespace() {
        let (digits, unit) = token.split_at(
            token
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(token.len()),
        );
        let Ok(n) = digits.parse::<i64>() else {
            continue;
        };
        let mult = match unit.to_ascii_lowercase().as_str() {
            "d" | "day" | "days" => 86_400,
            "h" | "hr" | "hrs" | "hour" | "hours" => 3_600,
            "m" | "min" | "mins" | "minute" | "minutes" => 60,
            "s" | "sec" | "secs" | "second" | "seconds" => 1,
            _ => continue,
        };
        total_secs = total_secs.saturating_add(n.saturating_mul(mult));
        matched = true;
    }
    matched.then(|| chrono::Duration::seconds(total_secs))
}

fn format_remaining_duration(d: chrono::Duration) -> String {
    let mins = (d.num_seconds().max(60) + 59) / 60;
    let days = mins / (60 * 24);
    let hours = (mins % (60 * 24)) / 60;
    let rem_mins = mins % 60;
    if days > 0 {
        format!("{days}d {hours}h")
    } else if hours > 0 {
        format!("{hours}h {rem_mins}m")
    } else {
        format!("{rem_mins}m")
    }
}

/// Evaluate whether a temporary limit error recorded at `conn.error_at` is
/// still active. Returns `None` if live `usage` already shows healthy quota or
/// the reset window has elapsed; otherwise returns `(limit_window, resets_in)`.
fn active_temporary_limit(
    err: &str,
    error_at: Option<&str>,
    usage: Option<&Usage>,
) -> Option<(Option<String>, Option<String>)> {
    if let Some(u) = usage
        && let Some(tightest) = u.tightest()
        && tightest.remaining >= EXHAUSTED_BELOW
    {
        return None;
    }
    let (window, resets) = parse_limit_note(err);
    if let (Some(resets_str), Some(ts_str)) = (resets.as_deref(), error_at)
        && let (Some(dur), Ok(ts)) = (
            parse_reset_duration(resets_str),
            chrono::DateTime::parse_from_rfc3339(ts_str),
        )
    {
        let remaining = (ts.with_timezone(&chrono::Utc) + dur) - chrono::Utc::now();
        if remaining <= chrono::Duration::zero() {
            return None;
        }
        return Some((window, Some(format_remaining_duration(remaining))));
    }
    Some((window, resets))
}

#[derive(Clone, Debug, Serialize, TS)]
pub struct SuggestedModel {
    pub id: String,
    pub provider: String,
    pub reason: String,
    pub slot: ChainSlot,
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

/// A model left out of suggestions, and why.
#[derive(Clone, Debug, Serialize, TS)]
pub struct ExcludedModel {
    pub id: String,
    pub provider: String,
    pub reason: String,
    /// When 9router's cooldown ends (temporary exclusions).
    pub until: Option<String>,
    /// Hidden by HiveDeck until the user restores it (e.g. the model is not
    /// available on this account at all).
    pub permanent: bool,
}

/// Outcome of pinging one model with a tiny real request.
#[derive(Clone, Debug, Serialize, TS)]
pub struct ModelCheck {
    pub id: String,
    pub ok: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
    pub permanent: bool,
    /// Failed only because the provider is out of quota for now: fine for a
    /// standby model, which the chain uses again after the reset.
    pub limited: bool,
}

#[derive(Clone, Debug, Serialize, TS)]
pub struct ComboSuggestions {
    pub roles: Vec<RoleSuggestion>,
    pub providers: Vec<ProviderHealth>,
    pub excluded: Vec<ExcludedModel>,
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
    let mut h = ProviderHealth::unknown(&conn.provider);
    if !conn.is_active {
        h.status = ProviderHealthStatus::Inactive;
        return h;
    }
    if let Some(usage) = usage {
        h.quotas = usage
            .quotas
            .iter()
            .map(|q| QuotaWindow {
                name: q.name.clone(),
                remaining_percent: (q.remaining * 100.0).round() as u8,
                reset_at: q.reset_at.clone(),
                remaining_amount: q.remaining_amount,
                currency: q.currency.clone(),
            })
            .collect();
        h.quotas.sort_by_key(|q| window_order(&q.name));
    }
    if let Some(err) = &conn.error {
        if is_temporary_limit(err) {
            if let Some((limit_window, resets_in)) =
                active_temporary_limit(err, conn.error_at.as_deref(), usage)
            {
                h.status = ProviderHealthStatus::Limited;
                h.limit_window = limit_window;
                h.resets_in = resets_in;
                h.summary = Some(summarize_message(err));
                h.message = Some(err.clone());
                return h;
            }
        } else {
            h.status = ProviderHealthStatus::Error;
            h.summary = Some(summarize_message(err));
            h.message = Some(err.clone());
            return h;
        }
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

/// Errors that will not go away by waiting: the model is unknown or not
/// offered on this account/plan.
pub fn is_permanent_failure(raw: &str) -> bool {
    let lower = raw.to_lowercase();
    [
        "model_not_found",
        "not supported",
        "does not exist",
        "unknown model",
        "invalid model",
        "model not found",
        "no such model",
        "not available on your plan",
        "unsupported model",
        // Paid-credit models on a subscription account (Anthropic answers
        // with a 429, but waiting won't help).
        "credits_required",
        "usage credits are required",
        // A provider whose backend won't start (e.g. MiMo "bootstrap failed").
        "bootstrap failed",
        // OpenCode's free models answer only inside the OpenCode app.
        "free usage limit reached",
        "freeusagelimiterror",
    ]
    .iter()
    .any(|n| lower.contains(n))
}

/// Part of a model id after the alias prefix: `cx/gpt-6` → `gpt-6`.
fn provider_model_name(id: &str) -> &str {
    id.split_once('/').map(|(_, rest)| rest).unwrap_or(id)
}

/// Models 9router has in cooldown on every usable connection of their
/// provider. A lock on one account is fine while another account can serve
/// the model (9router rotates).
pub fn locked_models(
    models: &[ModelInfo],
    locks: &[ModelLock],
    connections: &[Connection],
) -> Vec<ExcludedModel> {
    let mut usable: HashMap<&str, Vec<&str>> = HashMap::new();
    for c in connections
        .iter()
        .filter(|c| c.is_active && c.error.is_none())
    {
        usable
            .entry(c.provider.as_str())
            .or_default()
            .push(c.id.as_str());
    }
    let mut out = Vec::new();
    for m in models.iter().filter(|m| m.owned_by != "combo") {
        let provider = provider_for_alias(&m.owned_by);
        let Some(conns) = usable.get(provider.as_str()) else {
            continue;
        };
        let name = provider_model_name(&m.id);
        let matching: Vec<&ModelLock> = locks
            .iter()
            .filter(|l| l.provider == provider)
            .filter(|l| l.model.as_deref().is_none_or(|lm| lm == name || lm == m.id))
            .collect();
        let all_locked = conns
            .iter()
            .all(|cid| matching.iter().any(|l| l.connection_id == *cid));
        if matching.is_empty() || !all_locked {
            continue;
        }
        let raw = matching.iter().find_map(|l| l.last_error.as_deref());
        // Prefer an error that names this model; a connection's last error
        // may belong to another one.
        let names_model = raw.is_some_and(|e| e.contains(name));
        let reason = raw
            .filter(|_| names_model)
            .map(summarize_message)
            .unwrap_or_else(|| "In cooldown after errors".to_string());
        out.push(ExcludedModel {
            id: m.id.clone(),
            provider: provider.clone(),
            reason,
            until: matching.iter().filter_map(|l| l.until.clone()).max(),
            permanent: names_model && raw.is_some_and(is_permanent_failure),
        });
    }
    out
}

/// Turn a raw provider/9router error into one short line.
pub fn summarize_message(raw: &str) -> String {
    let lower = raw.to_lowercase();
    let known = [
        (
            &["free usage limit reached", "freeusagelimiterror"][..],
            AGENT_BLOCKED_FREE,
        ),
        (
            &["credits_required", "usage credits are required"][..],
            "Model not available on this account",
        ),
        (
            &["insufficient balance", "add usage credits", "402"][..],
            "Out of credits",
        ),
        (
            &["api_key_expired", "key has expired", "key expired"][..],
            "API key expired",
        ),
        (
            &["not supported when using codex with a chatgpt account"][..],
            "Not available with a ChatGPT login",
        ),
        (
            &[
                "model_not_found",
                "model not found",
                "does not exist",
                "no such model",
            ][..],
            "Model not available on this account",
        ),
        (
            &["not supported", "unsupported model"][..],
            "Model not supported",
        ),
        (
            &[
                "model is unavailable",
                "temporarily unavailable",
                "overloaded",
                "capacity",
            ][..],
            "Temporarily unavailable",
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
        ProviderHealthStatus::Ok => 6,
        ProviderHealthStatus::Unknown => 5,
        ProviderHealthStatus::Low => 4,
        ProviderHealthStatus::Limited => 3,
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
        .unwrap_or_else(|| ProviderHealth::unknown(provider))
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
const FRONTIER_TOKENS: &[&str] = &[
    "opus", "fable", "pro", "ultra", "max", "o3", "o4", "sol", "argon", "carbon",
];
/// Balanced "everyday" tiers of lines that otherwise read as frontier.
const MID_TOKENS: &[&str] = &["terra", "hydrogen"];
/// "Fast and affordable" tiers.
const LIGHT_TOKENS: &[&str] = &["luna"];
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
        if self.has(FAST_TOKENS) || self.has(LIGHT_TOKENS) || self.size_b().is_some_and(|b| b <= 32)
        {
            Tier::Fast
        } else if self.has(MID_TOKENS) {
            Tier::Strong
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
            // Coding agents loop many times: a mid tier does the volume,
            // frontier models are kept for planning and review.
            (ComboRole::Coder, Tier::Strong) => 1.0,
            (ComboRole::Coder, Tier::Frontier) => 0.7,
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
        let legacy = if self.name.version.is_empty() && self.name.has(LEGACY_TOKENS) {
            0.25
        } else {
            0.0
        };
        let free = if self.is_free() { FREE_PENALTY } else { 0.0 };
        let slow = if self.name.has(SLOW_TOKENS) { 0.1 } else { 0.0 };
        0.8 * tier + 0.2 * self.recency - unstable - legacy - free - slow
    }

    fn is_free(&self) -> bool {
        self.model.id.ends_with("-free")
            || self.model.id.ends_with(":free")
            || self.provider.contains("free")
            || self
                .health
                .is_some_and(|h| h.billing == ProviderBilling::Free)
    }

    fn is_backup(&self) -> bool {
        !self.is_free()
            && (is_pay_as_you_go(&self.provider)
                || self
                    .health
                    .is_some_and(|h| h.billing == ProviderBilling::PayAsYouGo))
    }

    fn slot(&self) -> ChainSlot {
        if self.is_backup() {
            ChainSlot::Backup
        } else if self.health.is_some_and(long_outage) {
            ChainSlot::Standby
        } else {
            ChainSlot::Primary
        }
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
            ComboRole::Fast => {
                // A 1M-context variant buys nothing for short calls.
                let long = if self.name.long_context { 0.05 } else { 0.0 };
                0.5 * self.speed() + 0.3 * self.quota() + 0.15 * self.recency + 0.05 - long
            }
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

/// Build a fallback chain (ADR-039), in three parts:
/// 1. primary — healthy subscription/free providers, best first, spread
///    across providers (each once before any twice, at most twice);
/// 2. standby — the best model of each provider that is out until a reset,
///    so the combo picks it up again on its own;
/// 3. backup — pay-as-you-go providers, last, so they are only billed when
///    everything else is out.
fn chain<'a>(
    ranked: &[(f64, &'a Candidate<'a>)],
    head: Option<&'a Candidate<'a>>,
) -> Vec<SuggestedModel> {
    let mut picks: Vec<&Candidate<'_>> = head.into_iter().collect();
    let same_model = |picks: &[&Candidate<'_>], c: &Candidate<'_>| {
        picks
            .iter()
            .any(|p| p.provider == c.provider && p.name.base == c.name.base)
    };
    let count_of = |picks: &[&Candidate<'_>], c: &Candidate<'_>| {
        picks.iter().filter(|p| p.provider == c.provider).count()
    };

    // Free models (rate-limited, often a daily cap) only after every
    // paid-for primary model.
    let primary: Vec<&Candidate<'_>> = ranked
        .iter()
        .map(|(_, c)| *c)
        .filter(|c| c.slot() == ChainSlot::Primary)
        .collect();
    for free_group in [false, true] {
        for distinct_pass in [true, false] {
            for c in primary.iter().filter(|c| c.is_free() == free_group) {
                if picks.len() >= PRIMARY_LEN {
                    break;
                }
                let n = count_of(&picks, c);
                let free = picks.iter().filter(|p| p.is_free()).count();
                if same_model(&picks, c)
                    || (distinct_pass && n > 0)
                    || n >= MAX_PER_PROVIDER
                    || (c.is_free() && free >= MAX_FREE)
                {
                    continue;
                }
                picks.push(c);
            }
        }
    }
    // Pay-as-you-go backups: the last-resort provider goes after the others.
    let mut backups: Vec<&(f64, &Candidate<'_>)> = ranked.iter().collect();
    backups.sort_by_key(|(_, c)| c.provider == LAST_RESORT_PROVIDER);
    let standby: Vec<&(f64, &Candidate<'_>)> = ranked.iter().collect();
    for (slot, cap, list) in [
        (ChainSlot::Standby, STANDBY_LEN, &standby),
        (ChainSlot::Backup, BACKUP_LEN, &backups),
    ] {
        let mut added = 0;
        for (_, c) in list.iter().copied() {
            if added >= cap {
                break;
            }
            if c.slot() == slot && count_of(&picks, c) == 0 {
                picks.push(c);
                added += 1;
            }
        }
    }
    picks
        .into_iter()
        .map(|c| SuggestedModel {
            id: c.model.id.clone(),
            provider: c.provider.clone(),
            reason: c.reason(),
            slot: c.slot(),
        })
        .collect()
}

pub fn suggest(
    models: &[ModelInfo],
    health: &HashMap<String, ProviderHealth>,
    existing: &[Combo],
    excluded: &HashSet<String>,
) -> Vec<RoleSuggestion> {
    let usable: Vec<(&ModelInfo, ModelName, String)> = models
        .iter()
        .filter(|m| is_chat_model(m) && !excluded.contains(&m.id))
        .filter_map(|m| {
            let provider = provider_for_alias(&m.owned_by);
            if health
                .get(&provider)
                .is_some_and(|h| !h.status.usable() && !h.status.temporary())
            {
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
    let mut heads: HashSet<String> = HashSet::new();
    let mut head_pools: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    // The strongest role picks first; each later role starts on a model (and
    // quota pool) not already heading another combo. Coder before reviewer
    // so the reviewer can prefer a different family.
    let order = [
        ComboRole::Planner,
        ComboRole::Coder,
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
        // The head: best primary model not heading another role, preferring
        // another quota pool; never a free model while a paid-for one exists.
        let head_score = |s: f64, c: &Candidate<'_>| {
            if heads.contains(&c.model.id) {
                s - SAME_HEAD_PENALTY
            } else if head_pools.contains(&c.provider) {
                s - SAME_HEAD_POOL_PENALTY
            } else {
                s
            }
        };
        let primary_heads = || {
            ranked
                .iter()
                .filter(|(_, c)| c.slot() == ChainSlot::Primary)
                .map(|(s, c)| (head_score(*s, c), *c))
        };
        let head = primary_heads()
            .filter(|(_, c)| !c.is_free())
            .max_by(|a, b| a.0.total_cmp(&b.0))
            .or_else(|| primary_heads().max_by(|a, b| a.0.total_cmp(&b.0)))
            .map(|(_, c)| c);
        let models = chain(&ranked, head);
        if let Some(head) = models.first() {
            heads.insert(head.id.clone());
            head_pools.insert(head.provider.clone());
        }
        if role == ComboRole::Coder {
            coder_family = models
                .first()
                .and_then(|m| candidates.iter().find(|c| c.model.id == m.id))
                .map(|c| c.family.clone());
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
            error_at: None,
        }
    }

    fn usage(remaining: f64) -> Usage {
        Usage {
            quotas: vec![Quota {
                name: "session (5h)".into(),
                remaining,
                reset_at: None,
                ..Default::default()
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

    fn lock(provider: &str, model: Option<&str>, conn: &str, err: &str) -> ModelLock {
        ModelLock {
            provider: provider.into(),
            model: model.map(str::to_string),
            connection_id: conn.into(),
            until: Some("2099-01-01T00:00:00Z".into()),
            last_error: Some(err.into()),
        }
    }

    #[test]
    fn excludes_models_locked_on_every_account() {
        let err = r#"HTTP 503: [codex/gpt-5.2] [400]: {"detail":"The 'gpt-5.2' model is not supported when using Codex with a ChatGPT account.","error":{"code":"model_not_found"}} (reset after 30m)"#;
        let conns = vec![conn("codex", true, None)];
        let out = locked_models(
            &catalog(),
            &[lock("codex", Some("gpt-5.2"), "codex-1", err)],
            &conns,
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "cx/gpt-5.2");
        assert!(out[0].permanent);
        assert_eq!(out[0].reason, "Not available with a ChatGPT login");

        // A second healthy account can still serve it: not excluded.
        let mut second = conn("codex", true, None);
        second.id = "codex-2".into();
        let out = locked_models(
            &catalog(),
            &[lock("codex", Some("gpt-5.2"), "codex-1", err)],
            &[conns[0].clone(), second],
        );
        assert!(out.is_empty());

        // Excluded ids never reach a chain.
        let excluded: HashSet<String> = ["cx/gpt-5.2-codex-high".to_string()].into();
        let roles = suggest(&catalog(), &HashMap::new(), &[], &excluded);
        assert!(
            roles
                .iter()
                .all(|r| r.models.iter().all(|m| m.id != "cx/gpt-5.2-codex-high"))
        );
    }

    #[test]
    fn summarizes_transient_unavailability() {
        let raw = "Upstream request failed: Model is unavailable";
        assert_eq!(summarize_message(raw), "Temporarily unavailable");
        assert!(!is_permanent_failure(raw));
    }

    #[test]
    fn classifies_permanent_failures() {
        assert!(is_permanent_failure("code: model_not_found"));
        assert!(is_permanent_failure(
            "The model is not supported when using Codex"
        ));
        assert!(!is_permanent_failure("HTTP 429: rate limit exceeded"));
        assert!(!is_permanent_failure("HTTP 503: upstream timeout"));
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
        // Google: Argon/Carbon frontier, Hydrogen the everyday model.
        assert_eq!(tier("ag/gemini-4-argon-medium"), Tier::Frontier);
        assert_eq!(tier("gemini/gemini-4-carbon"), Tier::Frontier);
        assert_eq!(tier("gemini/gemini-4-hydrogen"), Tier::Strong);
        // Codex lines: sol frontier, terra balanced, luna fast.
        assert_eq!(tier("cx/gpt-6.1-sol"), Tier::Frontier);
        assert_eq!(tier("cx/gpt-6.1-terra"), Tier::Strong);
        assert_eq!(tier("cx/gpt-6-luna"), Tier::Fast);
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
        let roles = suggest(&catalog(), &health, &[], &HashSet::new());
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
        let roles = suggest(&catalog(), &health, &[], &HashSet::new());
        assert_eq!(
            roles.iter().map(|r| r.role).collect::<Vec<_>>(),
            ComboRole::ALL.to_vec()
        );
        for r in &roles {
            assert!(r.models.len() <= PRIMARY_LEN + STANDBY_LEN + BACKUP_LEN);
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
        // Coder leads with a mid-tier or coding model from another quota
        // pool than the planner's head; review variants stay out of it.
        let coder = &roles[1];
        let head = &coder.models[0];
        assert!(
            tier(&head.id) == Tier::Strong || head.id.contains("codex"),
            "{:?}",
            coder.models
        );
        assert_ne!(
            head.provider, planner.models[0].provider,
            "{:?}",
            coder.models
        );
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
        let roles = suggest(&catalog(), &health, &[], &HashSet::new());
        // An exhausted provider leaves the primary part but stays on standby,
        // so the combo uses it again after the reset.
        let coder = &roles[1];
        assert!(coder.models[0].provider != "claude");
        let claude: Vec<_> = coder
            .models
            .iter()
            .filter(|m| m.provider == "claude")
            .collect();
        assert_eq!(claude.len(), 1);
        assert_eq!(claude[0].slot, ChainSlot::Standby);
    }

    #[test]
    fn pay_as_you_go_goes_last_and_limits_are_standby() {
        let mut limited = conn(
            "codex",
            true,
            Some("[429]: usage limit reached (weekly, resets in 4d 2h)"),
        );
        limited.id = "cx".into();
        let mut health = provider_health(&[
            (conn("claude", true, None), Some(usage(0.6))),
            (limited, None),
            (
                conn("deepseek", true, None),
                Some(Usage {
                    quotas: vec![Quota {
                        name: "Balance (USD)".into(),
                        remaining: 1.0,
                        reset_at: None,
                        ..Default::default()
                    }],
                    message: None,
                }),
            ),
        ]);
        for h in health.values_mut() {
            h.classify_billing();
        }
        assert_eq!(health["codex"].status, ProviderHealthStatus::Limited);
        assert_eq!(health["deepseek"].billing, ProviderBilling::PayAsYouGo);
        let mut models = catalog();
        models.push(model("ds/deepseek-v4-pro", "ds", true, true, 1_000_000));
        let roles = suggest(&models, &health, &[], &HashSet::new());
        for role in &roles {
            let slots: Vec<_> = role.models.iter().map(|m| m.slot).collect();
            // Primary, then standby, then backup — never out of order.
            let mut sorted = slots.clone();
            sorted.sort_by_key(|s| match s {
                ChainSlot::Primary => 0,
                ChainSlot::Standby => 1,
                ChainSlot::Backup => 2,
            });
            assert_eq!(slots, sorted, "{:?}", role.models);
            if let Some(last) = role.models.last().filter(|m| m.provider == "deepseek") {
                assert_eq!(last.slot, ChainSlot::Backup);
            }
        }
        assert!(
            roles[1]
                .models
                .iter()
                .any(|m| m.provider == "codex" && m.slot == ChainSlot::Standby)
        );
    }

    #[test]
    fn a_short_rate_limit_keeps_the_provider_primary() {
        let health = provider_health(&[
            (conn("claude", true, Some("[429]: rate limit")), None),
            (conn("codex", true, None), Some(usage(0.9))),
        ]);
        assert_eq!(health["claude"].status, ProviderHealthStatus::Limited);
        let roles = suggest(&catalog(), &health, &[], &HashSet::new());
        let planner = &roles[0];
        assert!(
            planner
                .models
                .iter()
                .any(|m| m.provider == "claude" && m.slot == ChainSlot::Primary),
            "{:?}",
            planner.models
        );
    }

    #[test]
    fn roles_start_on_different_models() {
        let roles = suggest(&catalog(), &HashMap::new(), &[], &HashSet::new());
        let heads: HashSet<_> = roles
            .iter()
            .filter_map(|r| r.models.first().map(|m| m.id.clone()))
            .collect();
        assert_eq!(heads.len(), roles.len());
    }

    #[test]
    fn free_models_are_never_paid_backups_and_deepseek_is_last() {
        let mut models = catalog();
        models.push(model(
            "openrouter/nvidia/nemotron-3-ultra:free",
            "openrouter",
            true,
            true,
            200_000,
        ));
        models.push(model(
            "gemini/gemini-4-hydrogen",
            "gemini",
            true,
            true,
            1_000_000,
        ));
        models.push(model("ds/deepseek-v4-pro", "ds", true, true, 1_000_000));
        let roles = suggest(&models, &HashMap::new(), &[], &HashSet::new());
        for role in &roles {
            let backups: Vec<_> = role
                .models
                .iter()
                .filter(|m| m.slot == ChainSlot::Backup)
                .collect();
            assert!(backups.iter().all(|m| !m.id.ends_with(":free")));
            if backups.iter().any(|m| m.provider == "deepseek") {
                assert_eq!(role.models.last().unwrap().provider, "deepseek");
            }
        }
    }

    #[test]
    fn limit_notes_are_parsed_and_billing_errors_are_not_temporary() {
        let raw = "OpenCode Go usage limit reached (weekly, resets in 4d 13h). To keep going";
        assert!(is_temporary_limit(raw));
        assert_eq!(
            parse_limit_note(raw),
            (Some("weekly".into()), Some("4d 13h".into()))
        );
        assert_eq!(
            parse_limit_note("Go usage limit reached (weekly, resets in 4d 5h)").0,
            Some("weekly".into())
        );
        assert!(!is_temporary_limit(
            "[429]: usage limit reached: insufficient balance (1008)"
        ));
        assert!(!is_temporary_limit("[402]: Add usage credits"));
        let free = r#"[429]: {"type":"error","error":{"type":"FreeUsageLimitError","message":"Free usage limit reached. Free models work in OpenCode"}}"#;
        assert!(is_permanent_failure(free));
        assert!(!is_temporary_limit(free));
        assert_eq!(summarize_message(free), AGENT_BLOCKED_FREE);
        assert!(agent_blocked("oc/nemotron-3.5-lightning-free", "opencode", true).is_some());
        assert!(agent_blocked("oc/big-pickle", "opencode", false).is_some());
        assert!(agent_blocked("oc/big-pickle", "opencode", true).is_none());
        assert!(agent_blocked("ocg/glm-5.3", "opencode-go", false).is_none());
        let credits = r#"[429]: {"error":{"type":"rate_limit_error","message":"Usage credits are required for this model.","details":{"error_code":"credits_required"}}}"#;
        assert!(!is_temporary_limit(credits));
        assert!(is_permanent_failure(credits));
        assert_eq!(
            summarize_message(credits),
            "Model not available on this account"
        );
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
        let first = suggest(&catalog(), &health, &[], &HashSet::new());
        let coder = first.iter().find(|r| r.role == ComboRole::Coder).unwrap();
        let existing = vec![Combo {
            id: "1".into(),
            name: "coder".into(),
            models: coder.models.iter().map(|m| m.id.clone()).collect(),
            kind: None,
        }];
        let again = suggest(&catalog(), &health, &existing, &HashSet::new());
        let coder = again.iter().find(|r| r.role == ComboRole::Coder).unwrap();
        assert!(coder.up_to_date);
        let planner = again.iter().find(|r| r.role == ComboRole::Planner).unwrap();
        assert!(planner.existing_models.is_none() && !planner.up_to_date);
    }
}
