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

fn parse_connection(v: &Value) -> Option<Connection> {
    let is_active = match v.get("isActive") {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_i64() != Some(0),
        _ => true,
    };
    // Status fields vary by provider/version; take whatever error is present.
    let failed_test = v
        .get("testStatus")
        .and_then(Value::as_str)
        .is_some_and(|s| matches!(s, "error" | "failed" | "expired" | "invalid"));
    let error = str_field(v, &["lastError", "errorMessage", "lastErrorMessage"]).or_else(|| {
        failed_test.then(|| {
            str_field(v, &["testStatus"]).unwrap_or_else(|| "connection test failed".to_string())
        })
    });
    Some(Connection {
        id: str_field(v, &["id"])?,
        provider: str_field(v, &["provider"])?,
        name: str_field(v, &["name", "email"]),
        auth_type: str_field(v, &["authType"]),
        is_active,
        error,
    })
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
            quotas.push(Quota {
                name: name.clone(),
                remaining: remaining.clamp(0.0, 1.0),
                reset_at: q.get("resetAt").and_then(Value::as_str).map(str::to_string),
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
}

#[cfg(test)]
mod tests {
    use super::*;

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

        let off = parse_connection(&json!({ "id": "b", "provider": "codex", "isActive": false }))
            .unwrap();
        assert!(!off.is_active);
        assert!(off.error.is_none());
        assert!(parse_connection(&json!({ "provider": "x" })).is_none());
    }
}
