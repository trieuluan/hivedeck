//! Client for 9router's management API (`/api/providers`, `/api/usage`,
//! `/api/combos`), authenticated with 9router's local CLI token.
//!
//! 9router accepts an `x-9r-cli-token` header on every `/api/*` route. Its
//! own CLI derives the token on the same machine as
//! `sha256(machine-id + "9r-cli-auth" + cli-secret)[..16]` from two files in
//! 9router's data dir. HiveDeck does the same, only after the user opts in
//! (`NineRouterSettings::allow_management`), and only talks to loopback.
//! The token is never stored, logged or sent anywhere else.

use std::{path::PathBuf, time::Duration};

use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const CLI_TOKEN_HEADER: &str = "x-9r-cli-token";
const CLI_AUTH_SALT: &str = "9r-cli-auth";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error(
        "9router's CLI credentials were not found in {0}; start 9router once so it creates them"
    )]
    MissingCredentials(String),
    #[error("9router rejected HiveDeck's CLI token (HTTP {0})")]
    Unauthorized(u16),
    #[error("9router API error (HTTP {status}): {message}")]
    Http { status: u16, message: String },
    #[error("could not reach 9router: {0}")]
    Network(String),
}

/// 9router's data dir (`~/.9router`, or `%APPDATA%\9router` on Windows).
pub fn data_dir() -> PathBuf {
    if cfg!(windows)
        && let Some(appdata) = std::env::var_os("APPDATA")
    {
        return PathBuf::from(appdata).join("9router");
    }
    dirs::home_dir().unwrap_or_default().join(".9router")
}

fn derive_token(machine_id: &str, cli_secret: &str) -> String {
    let digest = Sha256::digest(format!("{machine_id}{CLI_AUTH_SALT}{cli_secret}").as_bytes());
    digest
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>()[..16]
        .to_string()
}

fn cli_token() -> Result<String, ApiError> {
    let dir = data_dir();
    let read = |rel: &str| {
        std::fs::read_to_string(dir.join(rel))
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    match (read("machine-id"), read("auth/cli-secret")) {
        (Some(id), Some(secret)) => Ok(derive_token(&id, &secret)),
        _ => Err(ApiError::MissingCredentials(dir.display().to_string())),
    }
}

/// A provider connection as listed by `GET /api/providers` (secrets are
/// already stripped by 9router).
#[derive(Clone, Debug)]
pub struct Connection {
    pub id: String,
    pub provider: String,
    pub name: Option<String>,
    pub auth_type: Option<String>,
    pub is_active: bool,
    /// Last error 9router recorded for this connection, if any.
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct Quota {
    pub name: String,
    /// 0.0..=1.0 remaining.
    pub remaining: f64,
    pub reset_at: Option<String>,
    /// Remaining monetary balance when the provider reports a credit balance
    /// (e.g. DeepSeek `isCreditBalance: true`).
    pub remaining_amount: Option<f64>,
    pub currency: Option<String>,
}

/// `GET /api/usage/<id>`; providers without a usage API return only a message.
#[derive(Clone, Debug, Default)]
pub struct Usage {
    pub quotas: Vec<Quota>,
    pub message: Option<String>,
}

impl Usage {
    /// The tightest quota window, e.g. the 5-hour session at 10% left.
    pub fn tightest(&self) -> Option<&Quota> {
        self.quotas
            .iter()
            .min_by(|a, b| a.remaining.total_cmp(&b.remaining))
    }
}

/// A model 9router has locked on one connection (`GET /api/models/availability`).
#[derive(Clone, Debug)]
pub struct ModelLock {
    pub provider: String,
    /// Provider-side model name without the alias prefix, or `None` when the
    /// whole connection is unavailable.
    pub model: Option<String>,
    pub connection_id: String,
    pub until: Option<String>,
    pub last_error: Option<String>,
}

/// Result of `POST /api/models/test` (a tiny real completion).
#[derive(Clone, Debug, Default)]
pub struct Ping {
    pub ok: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Combo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub kind: Option<String>,
}

pub struct Client {
    http: reqwest::Client,
    base: String,
    token: String,
}

fn str_field(v: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| {
        v.get(*k)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    })
}

/// The error is about one model (`[codex/gpt-x] ...`, "model not found",
/// "not supported"), not the account.
pub fn is_model_specific_error(err: &str, provider: &str) -> bool {
    let lower = err.to_lowercase();
    super::advisor::is_permanent_failure(err)
        || lower.contains(&format!("[{}/", provider.to_lowercase()))
}

fn parse_connection(v: &Value) -> Option<Connection> {
    let is_active = match v.get("isActive") {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_i64() != Some(0),
        _ => true,
    };
    let provider = str_field(v, &["provider"])?;
    let test_status = str_field(v, &["testStatus"]);
    let failed_test = test_status.as_deref().is_some_and(|s| {
        matches!(
            s,
            "error" | "failed" | "expired" | "invalid" | "unavailable"
        )
    });
    let last_error = str_field(v, &["lastError", "errorMessage", "lastErrorMessage"]);
    // 9router records a failing *model* on the connection too (lastError,
    // testStatus "unavailable"); that must not take the whole provider out,
    // the per-model lock already covers it.
    let model_specific = last_error
        .as_deref()
        .is_some_and(|e| is_model_specific_error(e, &provider));
    let error = if model_specific {
        None
    } else if failed_test {
        last_error.or_else(|| test_status.clone())
    } else if test_status.is_none() {
        last_error
    } else {
        None
    };
    Some(Connection {
        id: str_field(v, &["id"])?,
        provider,
        name: str_field(v, &["name", "email"]),
        auth_type: str_field(v, &["authType"]),
        is_active,
        error,
    })
}

/// Totals for one provider in 9router's usage stats.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProviderUsage {
    pub requests: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cached_tokens: u64,
    /// USD, as 9router priced it (0 when it has no price for the model).
    pub cost: f64,
}

fn parse_usage_by_provider(v: &Value) -> std::collections::HashMap<String, ProviderUsage> {
    let num = |o: &Value, k: &str| o.get(k).and_then(Value::as_f64).unwrap_or(0.0);
    v.get("byProvider")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .map(|(provider, o)| {
                    (
                        provider.clone(),
                        ProviderUsage {
                            requests: num(o, "requests") as u64,
                            prompt_tokens: num(o, "promptTokens") as u64,
                            completion_tokens: num(o, "completionTokens") as u64,
                            cached_tokens: num(o, "cachedTokens") as u64,
                            cost: num(o, "cost"),
                        },
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_usage(v: &Value) -> Usage {
    let mut quotas = Vec::new();
    if let Some(map) = v.get("quotas").and_then(Value::as_object) {
        for (name, q) in map {
            let num = |k: &str| q.get(k).and_then(Value::as_f64);
            let remaining = match (num("remaining"), num("total"), num("used")) {
                (Some(r), Some(t), _) if t > 0.0 => r / t,
                (None, Some(t), Some(u)) if t > 0.0 => (t - u) / t,
                _ => match num("remainingPercentage") {
                    Some(p) => p / 100.0,
                    None => continue,
                },
            };
            let is_credit_balance = q
                .get("isCreditBalance")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || name.to_lowercase().contains("balance")
                || name.to_lowercase().contains("credit");
            let remaining_amount = if is_credit_balance {
                match (num("remaining"), num("total"), num("used")) {
                    (Some(r), _, _) if r.is_finite() => Some(r.max(0.0)),
                    (None, Some(t), Some(u)) if t.is_finite() && u.is_finite() => {
                        Some((t - u).max(0.0))
                    }
                    (None, Some(t), None) if t.is_finite() => Some(t.max(0.0)),
                    _ => None,
                }
            } else {
                None
            };
            let currency = q
                .get("currency")
                .and_then(Value::as_str)
                .map(|s| s.trim().to_uppercase())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    if is_credit_balance && name.to_uppercase().contains("USD") {
                        Some("USD".to_string())
                    } else if is_credit_balance && name.to_uppercase().contains("CNY") {
                        Some("CNY".to_string())
                    } else {
                        None
                    }
                });
            quotas.push(Quota {
                name: name.clone(),
                remaining: remaining.clamp(0.0, 1.0),
                reset_at: q.get("resetAt").and_then(Value::as_str).map(str::to_string),
                remaining_amount,
                currency,
            });
        }
    }
    Usage {
        quotas,
        message: str_field(v, &["message", "error"]),
    }
}

impl Client {
    /// Client for the router on `port`. Fails if the CLI credentials are
    /// missing (9router has never run on this machine).
    pub fn new(port: u16) -> Result<Self, ApiError> {
        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|e| ApiError::Network(e.to_string()))?;
        Ok(Self {
            http,
            base: format!("http://127.0.0.1:{port}"),
            token: cli_token()?,
        })
    }

    async fn send(&self, req: reqwest::RequestBuilder) -> Result<Value, ApiError> {
        let resp = req
            .header(CLI_TOKEN_HEADER, &self.token)
            .send()
            .await
            .map_err(|e| ApiError::Network(e.to_string()))?;
        let status = resp.status().as_u16();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        match status {
            200..=299 => Ok(body),
            401 | 403 => Err(ApiError::Unauthorized(status)),
            _ => Err(ApiError::Http {
                status,
                message: str_field(&body, &["error", "message"])
                    .unwrap_or_else(|| "unknown error".to_string()),
            }),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    pub async fn connections(&self) -> Result<Vec<Connection>, ApiError> {
        let body = self.send(self.http.get(self.url("/api/providers"))).await?;
        Ok(body
            .get("connections")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(parse_connection).collect())
            .unwrap_or_default())
    }

    /// Usage for one connection. A failed lookup becomes a `Usage` carrying
    /// the error message (e.g. expired credentials), not an `Err`.
    pub async fn usage(&self, connection_id: &str) -> Result<Usage, ApiError> {
        let req = self
            .http
            .get(self.url(&format!("/api/usage/{connection_id}")));
        match self.send(req).await {
            Ok(body) => Ok(parse_usage(&body)),
            Err(ApiError::Http { message, .. }) => Ok(Usage {
                quotas: Vec::new(),
                message: Some(message),
            }),
            // The usage route answers 401 when the provider's own credential
            // refresh fails; distinguish that from our token being rejected
            // by checking a route that needs only our token.
            Err(ApiError::Unauthorized(status)) => {
                self.combos().await?;
                Ok(Usage {
                    quotas: Vec::new(),
                    message: Some(format!(
                        "provider credentials need attention (HTTP {status})"
                    )),
                })
            }
            Err(e) => Err(e),
        }
    }

    /// 9router's own usage totals per provider for `period` (`today`,
    /// `24h`, `7d`, `30d`…), with the cost it priced from its pricing table.
    pub async fn usage_by_provider(
        &self,
        period: &str,
    ) -> Result<std::collections::HashMap<String, ProviderUsage>, ApiError> {
        let req = self
            .http
            .get(self.url("/api/usage/stats"))
            .query(&[("period", period)]);
        let body = self.send(req).await?;
        Ok(parse_usage_by_provider(&body))
    }

    pub async fn model_locks(&self) -> Result<Vec<ModelLock>, ApiError> {
        let body = self
            .send(self.http.get(self.url("/api/models/availability")))
            .await?;
        Ok(body
            .get("models")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|v| {
                        let model = str_field(v, &["model"])?;
                        Some(ModelLock {
                            provider: str_field(v, &["provider"])?,
                            model: (model != "__all").then_some(model),
                            connection_id: str_field(v, &["connectionId"]).unwrap_or_default(),
                            until: str_field(v, &["until"]),
                            last_error: str_field(v, &["lastError"]),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Ping one model with a tiny real request through 9router.
    pub async fn ping(&self, model: &str) -> Result<Ping, ApiError> {
        let req = self
            .http
            .post(self.url("/api/models/test"))
            .timeout(Duration::from_secs(60))
            .json(&json!({ "model": model, "kind": "llm" }));
        let body = match self.send(req).await {
            Ok(body) => body,
            Err(ApiError::Http { message, .. }) => {
                return Ok(Ping {
                    ok: false,
                    latency_ms: None,
                    error: Some(message),
                });
            }
            Err(e) => return Err(e),
        };
        Ok(Ping {
            ok: body.get("ok").and_then(Value::as_bool).unwrap_or(false),
            latency_ms: body.get("latencyMs").and_then(Value::as_u64),
            error: str_field(&body, &["error"]),
        })
    }

    pub async fn combos(&self) -> Result<Vec<Combo>, ApiError> {
        let body = self.send(self.http.get(self.url("/api/combos"))).await?;
        Ok(body
            .get("combos")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default())
    }

    pub async fn create_combo(&self, name: &str, models: &[String]) -> Result<(), ApiError> {
        let req = self
            .http
            .post(self.url("/api/combos"))
            .json(&json!({ "name": name, "models": models }));
        self.send(req).await.map(|_| ())
    }

    pub async fn delete_combo(&self, id: &str) -> Result<(), ApiError> {
        let req = self.http.delete(self.url(&format!("/api/combos/{id}")));
        self.send(req).await.map(|_| ())
    }

    pub async fn update_combo(&self, id: &str, models: &[String]) -> Result<(), ApiError> {
        let req = self
            .http
            .put(self.url(&format!("/api/combos/{id}")))
            .json(&json!({ "models": models }));
        self.send(req).await.map(|_| ())
    }

    /// How every combo walks its models (`fallback` or `round-robin`).
    /// Clears per-combo overrides so the choice applies to all combos.
    pub async fn set_combo_strategy(&self, strategy: &str) -> Result<(), ApiError> {
        let req = self.http.patch(self.url("/api/settings")).json(&json!({
            "comboStrategy": strategy,
            "comboStrategies": {},
        }));
        self.send(req).await.map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_usage_by_provider() {
        let v = serde_json::json!({
            "totalCost": 1.5,
            "byProvider": {
                "gemini": {"requests": 12, "promptTokens": 1000, "completionTokens": 200, "cachedTokens": 800, "cost": 0.42},
                "deepseek": {"requests": 3}
            }
        });
        let m = parse_usage_by_provider(&v);
        assert_eq!(m["gemini"].requests, 12);
        assert!((m["gemini"].cost - 0.42).abs() < 1e-9);
        assert_eq!(m["deepseek"].cost, 0.0);
        assert!(parse_usage_by_provider(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn token_matches_9router_derivation() {
        // sha256("abc" + "9r-cli-auth" + "def") truncated to 16 hex chars.
        let expected = {
            let d = Sha256::digest(b"abc9r-cli-authdef");
            d.iter().map(|b| format!("{b:02x}")).collect::<String>()[..16].to_string()
        };
        assert_eq!(derive_token("abc", "def"), expected);
        assert_eq!(derive_token("abc", "def").len(), 16);
    }

    #[test]
    fn parses_usage_shapes() {
        let v = json!({
            "quotas": {
                "session (5h)": { "used": 87, "total": 100, "remaining": 13, "resetAt": "2026-11-17T01:00:00Z" },
                "weekly (7d)": { "used": 40, "total": 100, "remaining": 60 },
                "pct": { "remainingPercentage": 50 }
            }
        });
        let u = parse_usage(&v);
        assert_eq!(u.quotas.len(), 3);
        let tight = u.tightest().unwrap();
        assert_eq!(tight.name, "session (5h)");
        assert!((tight.remaining - 0.13).abs() < 1e-9);

        let msg = parse_usage(&json!({ "message": "Usage not available" }));
        assert!(msg.quotas.is_empty());
        assert_eq!(msg.message.as_deref(), Some("Usage not available"));
    }

    #[test]
    fn parses_connections_tolerantly() {
        let c = parse_connection(&json!({
            "id": "a1", "provider": "claude", "authType": "oauth",
            "isActive": 1, "testStatus": "expired"
        }))
        .unwrap();
        assert!(c.is_active);
        assert_eq!(c.error.as_deref(), Some("expired"));

        // A model failure recorded on the connection is not an account error.
        let m = parse_connection(&json!({
            "id": "c1", "provider": "codex", "testStatus": "unavailable",
            "lastError": "HTTP 503: [codex/gpt-x] [400]: model is not supported when using Codex with a ChatGPT account"
        }))
        .unwrap();
        assert!(m.error.is_none());

        let off = parse_connection(&json!({ "id": "b", "provider": "codex", "isActive": false }))
            .unwrap();
        assert!(!off.is_active);
        assert!(off.error.is_none());
        assert!(parse_connection(&json!({ "provider": "x" })).is_none());
    }
}
