use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use ts_rs::TS;

use crate::plugins::{
    InstalledPlugin, PluginError, PluginMcpEntry, plugin_asset_dir, read_plugin_secrets,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredMcpOAuthToken {
    pub access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_endpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization_server: Option<String>,
    pub updated_at: i64,
}

pub type PluginsOAuthTokens = BTreeMap<String, BTreeMap<String, StoredMcpOAuthToken>>;

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct PluginMcpOAuthStatus {
    pub mcp: String,
    pub connected: bool,
    pub expires_at: Option<i64>,
    pub authorization_server: Option<String>,
    pub has_refresh_token: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct PluginMcpToolInfo {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug)]
struct DiscoveredOAuthMetadata {
    authorization_server: String,
    authorization_endpoint: String,
    token_endpoint: String,
    registration_endpoint: Option<String>,
    scope: Option<String>,
}

#[derive(Clone, Debug)]
struct PendingOAuthSession {
    plugin_name: String,
    mcp_name: String,
    code_verifier: String,
    redirect_uri: String,
    token_endpoint: String,
    client_id: String,
    client_secret: Option<String>,
    scope: Option<String>,
    authorization_server: String,
    created_at: i64,
}

static OAUTH_WRITE_LOCK: Mutex<()> = Mutex::new(());
static PENDING_SESSIONS: LazyLock<Mutex<HashMap<String, PendingOAuthSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn oauth_tokens_path(dir: &Path) -> PathBuf {
    dir.join("plugins_oauth.json")
}

pub fn read_oauth_tokens(dir: &Path) -> Result<PluginsOAuthTokens, PluginError> {
    let path = oauth_tokens_path(dir);
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let body = fs::read_to_string(&path)?;
    if body.trim().is_empty() {
        return Ok(BTreeMap::new());
    }
    serde_json::from_str(&body)
        .map_err(|err| PluginError::BadRequest(format!("Invalid plugins_oauth.json: {err}")))
}

fn write_oauth_tokens_locked(dir: &Path, tokens: &PluginsOAuthTokens) -> Result<(), PluginError> {
    fs::create_dir_all(dir)?;
    let path = oauth_tokens_path(dir);
    let body = serde_json::to_string_pretty(tokens).map_err(|err| {
        PluginError::BadRequest(format!("Failed to serialize OAuth tokens: {err}"))
    })?;
    let mut temp = tempfile::NamedTempFile::new_in(dir)?;
    temp.write_all(body.as_bytes())?;
    temp.flush()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o600))?;
    }
    temp.persist(&path).map_err(|err| err.error)?;
    Ok(())
}

pub fn set_oauth_token(
    dir: &Path,
    plugin: &str,
    mcp: &str,
    token: StoredMcpOAuthToken,
) -> Result<(), PluginError> {
    let _guard = OAUTH_WRITE_LOCK.lock().unwrap();
    let mut tokens = read_oauth_tokens(dir)?;
    tokens
        .entry(plugin.to_owned())
        .or_default()
        .insert(mcp.to_owned(), token);
    write_oauth_tokens_locked(dir, &tokens)
}

pub fn remove_oauth_token(dir: &Path, plugin: &str, mcp: &str) -> Result<bool, PluginError> {
    let _guard = OAUTH_WRITE_LOCK.lock().unwrap();
    let mut tokens = read_oauth_tokens(dir)?;
    let removed = tokens
        .get_mut(plugin)
        .and_then(|by_mcp| by_mcp.remove(mcp))
        .is_some();
    if tokens.get(plugin).is_some_and(BTreeMap::is_empty) {
        tokens.remove(plugin);
    }
    if removed {
        write_oauth_tokens_locked(dir, &tokens)?;
    }
    Ok(removed)
}

pub fn remove_plugin_oauth_tokens(dir: &Path, plugin: &str) -> Result<(), PluginError> {
    let _guard = OAUTH_WRITE_LOCK.lock().unwrap();
    let mut tokens = read_oauth_tokens(dir)?;
    if tokens.remove(plugin).is_some() {
        write_oauth_tokens_locked(dir, &tokens)?;
    }
    Ok(())
}

fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

fn random_url_safe(num_bytes: usize) -> String {
    let mut bytes = vec![0u8; num_bytes];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(&bytes)
}

pub fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

pub fn extract_resource_metadata_url(www_authenticate: &str) -> Option<String> {
    let lower = www_authenticate.to_ascii_lowercase();
    let marker = "resource_metadata=";
    let idx = lower.find(marker)?;
    let rest = www_authenticate[idx + marker.len()..].trim_start();
    if let Some(stripped) = rest.strip_prefix('"') {
        let end = stripped.find('"')?;
        Some(stripped[..end].to_owned())
    } else {
        let end = rest.find([',', ' ']).unwrap_or(rest.len());
        let val = rest[..end].trim();
        (!val.is_empty()).then(|| val.to_owned())
    }
}

fn build_http_client() -> Result<reqwest::Client, PluginError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("HiveDeck-MCP-OAuth/1.0")
        .build()
        .map_err(|err| PluginError::BadRequest(format!("Failed to build HTTP client: {err}")))
}

fn well_known_urls_for_resource(mcp_url: &Url) -> Vec<String> {
    let origin = format!(
        "{}://{}{}",
        mcp_url.scheme(),
        mcp_url.host_str().unwrap_or_default(),
        mcp_url.port().map(|p| format!(":{p}")).unwrap_or_default()
    );
    let path = mcp_url.path().trim_matches('/');
    let mut urls = Vec::new();
    if !path.is_empty() {
        urls.push(format!(
            "{origin}/.well-known/oauth-protected-resource/{path}"
        ));
    }
    urls.push(format!("{origin}/.well-known/oauth-protected-resource"));
    urls
}

fn auth_server_metadata_urls(auth_server: &str) -> Vec<String> {
    let trimmed = auth_server.trim_end_matches('/');
    let mut urls = vec![
        format!("{trimmed}/.well-known/oauth-authorization-server"),
        format!("{trimmed}/.well-known/openid-configuration"),
    ];
    if let Ok(parsed) = Url::parse(trimmed) {
        let path = parsed.path().trim_matches('/');
        if !path.is_empty() {
            let origin = format!(
                "{}://{}{}",
                parsed.scheme(),
                parsed.host_str().unwrap_or_default(),
                parsed.port().map(|p| format!(":{p}")).unwrap_or_default()
            );
            urls.push(format!(
                "{origin}/.well-known/oauth-authorization-server/{path}"
            ));
            urls.push(format!("{origin}/.well-known/openid-configuration/{path}"));
        }
    }
    urls
}

async fn fetch_json(client: &reqwest::Client, url: &str) -> Option<Value> {
    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<Value>().await.ok()
}

async fn discover_oauth_metadata(
    client: &reqwest::Client,
    mcp_url_str: &str,
) -> Result<DiscoveredOAuthMetadata, PluginError> {
    let mcp_url = Url::parse(mcp_url_str).map_err(|err| {
        PluginError::BadRequest(format!("Invalid MCP URL '{mcp_url_str}': {err}"))
    })?;
    if !matches!(mcp_url.scheme(), "https" | "http") {
        return Err(PluginError::BadRequest(
            "OAuth is only supported for http/https MCP URLs".into(),
        ));
    }

    let mut protected_candidates = Vec::new();
    if let Ok(probe_resp) = client.get(mcp_url.clone()).send().await
        && let Some(header_val) = probe_resp.headers().get(reqwest::header::WWW_AUTHENTICATE)
        && let Ok(header_str) = header_val.to_str()
        && let Some(meta_url) = extract_resource_metadata_url(header_str)
    {
        protected_candidates.push(meta_url);
    }
    protected_candidates.extend(well_known_urls_for_resource(&mcp_url));

    let mut auth_server: Option<String> = None;
    let mut resource_scopes: Option<String> = None;

    for candidate in protected_candidates {
        if let Some(meta) = fetch_json(client, &candidate).await {
            if let Some(server) = meta
                .get("authorization_servers")
                .and_then(Value::as_array)
                .and_then(|arr| arr.first())
                .and_then(Value::as_str)
            {
                auth_server = Some(server.to_owned());
            }
            if let Some(scopes) = meta.get("scopes_supported").and_then(Value::as_array) {
                let joined: Vec<&str> = scopes.iter().filter_map(Value::as_str).collect();
                if !joined.is_empty() {
                    resource_scopes = Some(joined.join(" "));
                }
            }
            if auth_server.is_some() {
                break;
            }
        }
    }

    let fallback_origin = format!(
        "{}://{}{}",
        mcp_url.scheme(),
        mcp_url.host_str().unwrap_or_default(),
        mcp_url.port().map(|p| format!(":{p}")).unwrap_or_default()
    );
    let auth_server = auth_server.unwrap_or(fallback_origin);

    let mut auth_meta: Option<Value> = None;
    for url in auth_server_metadata_urls(&auth_server) {
        if let Some(meta) = fetch_json(client, &url).await
            && meta.get("authorization_endpoint").is_some()
            && meta.get("token_endpoint").is_some()
        {
            auth_meta = Some(meta);
            break;
        }
    }

    let auth_meta = auth_meta.ok_or_else(|| {
        PluginError::BadRequest(format!(
            "Could not discover OAuth 2.1 endpoints for '{mcp_url_str}'"
        ))
    })?;

    let authorization_endpoint = auth_meta
        .get("authorization_endpoint")
        .and_then(Value::as_str)
        .ok_or_else(|| PluginError::BadRequest("Missing authorization_endpoint".into()))?
        .to_owned();
    let token_endpoint = auth_meta
        .get("token_endpoint")
        .and_then(Value::as_str)
        .ok_or_else(|| PluginError::BadRequest("Missing token_endpoint".into()))?
        .to_owned();
    let registration_endpoint = auth_meta
        .get("registration_endpoint")
        .and_then(Value::as_str)
        .map(str::to_owned);

    let server_scopes = auth_meta
        .get("scopes_supported")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|s| !s.is_empty());

    Ok(DiscoveredOAuthMetadata {
        authorization_server: auth_server,
        authorization_endpoint,
        token_endpoint,
        registration_endpoint,
        scope: resource_scopes.or(server_scopes),
    })
}

async fn register_dynamic_client(
    client: &reqwest::Client,
    registration_endpoint: &str,
    redirect_uri: &str,
) -> Result<(String, Option<String>), PluginError> {
    let payload = serde_json::json!({
        "client_name": "HiveDeck",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none"
    });
    let resp = client
        .post(registration_endpoint)
        .json(&payload)
        .send()
        .await
        .map_err(|err| {
            PluginError::BadRequest(format!("OAuth client registration failed: {err}"))
        })?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(PluginError::BadRequest(format!(
            "OAuth client registration returned {status}: {text}"
        )));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|err| PluginError::BadRequest(format!("Invalid registration JSON: {err}")))?;
    let client_id = body
        .get("client_id")
        .and_then(Value::as_str)
        .ok_or_else(|| PluginError::BadRequest("Registration response missing client_id".into()))?
        .to_owned();
    let client_secret = body
        .get("client_secret")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok((client_id, client_secret))
}

pub async fn start_oauth_flow(
    plugin_name: &str,
    mcp_name: &str,
    mcp_url: &str,
    redirect_uri: &str,
) -> Result<String, PluginError> {
    let client = build_http_client()?;
    let meta = discover_oauth_metadata(&client, mcp_url).await?;
    let registration_endpoint = meta.registration_endpoint.as_deref().ok_or_else(|| {
        PluginError::BadRequest(
            "OAuth server does not advertise dynamic client registration (registration_endpoint)"
                .into(),
        )
    })?;
    let (client_id, client_secret) =
        register_dynamic_client(&client, registration_endpoint, redirect_uri).await?;

    let state = random_url_safe(24);
    let code_verifier = random_url_safe(48);
    let challenge = pkce_challenge(&code_verifier);

    let mut auth_url = Url::parse(&meta.authorization_endpoint)
        .map_err(|err| PluginError::BadRequest(format!("Invalid authorization_endpoint: {err}")))?;
    {
        let mut query = auth_url.query_pairs_mut();
        query.append_pair("response_type", "code");
        query.append_pair("client_id", &client_id);
        query.append_pair("redirect_uri", redirect_uri);
        query.append_pair("state", &state);
        query.append_pair("code_challenge", &challenge);
        query.append_pair("code_challenge_method", "S256");
        if let Some(scope) = &meta.scope {
            query.append_pair("scope", scope);
        }
    }

    let now = now_unix();
    let mut pending = PENDING_SESSIONS.lock().unwrap();
    pending.retain(|_, session| now - session.created_at < 600);
    pending.insert(
        state,
        PendingOAuthSession {
            plugin_name: plugin_name.to_owned(),
            mcp_name: mcp_name.to_owned(),
            code_verifier,
            redirect_uri: redirect_uri.to_owned(),
            token_endpoint: meta.token_endpoint,
            client_id,
            client_secret,
            scope: meta.scope,
            authorization_server: meta.authorization_server,
            created_at: now,
        },
    );

    Ok(auth_url.to_string())
}

fn encode_form(pairs: &[(&str, String)]) -> String {
    let mut url = Url::parse("http://localhost").expect("valid base url");
    {
        let mut qp = url.query_pairs_mut();
        for (k, v) in pairs {
            qp.append_pair(k, v);
        }
    }
    url.query().unwrap_or_default().to_owned()
}

pub async fn complete_oauth_callback(
    dir: &Path,
    state: &str,
    code: &str,
) -> Result<(String, String), PluginError> {
    let session = {
        let mut pending = PENDING_SESSIONS.lock().unwrap();
        pending.remove(state)
    }
    .ok_or_else(|| {
        PluginError::BadRequest(
            "Invalid or expired OAuth state. Please try signing in again.".into(),
        )
    })?;

    let client = build_http_client()?;
    let mut form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code.to_string()),
        ("redirect_uri", session.redirect_uri.clone()),
        ("client_id", session.client_id.clone()),
        ("code_verifier", session.code_verifier.clone()),
    ];
    if let Some(secret) = &session.client_secret {
        form.push(("client_secret", secret.clone()));
    }

    let resp = client
        .post(&session.token_endpoint)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(encode_form(&form))
        .send()
        .await
        .map_err(|err| PluginError::BadRequest(format!("OAuth token exchange failed: {err}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(PluginError::BadRequest(format!(
            "OAuth token endpoint returned {status}: {text}"
        )));
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|err| PluginError::BadRequest(format!("Invalid token JSON: {err}")))?;
    let access_token = body
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or_else(|| PluginError::BadRequest("Token response missing access_token".into()))?
        .to_owned();
    let refresh_token = body
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let expires_in = body.get("expires_in").and_then(Value::as_i64);
    let now = now_unix();
    let expires_at = expires_in.map(|secs| now + secs);
    let scope = body
        .get("scope")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or(session.scope);

    let stored = StoredMcpOAuthToken {
        access_token,
        refresh_token,
        expires_at,
        token_endpoint: Some(session.token_endpoint),
        client_id: Some(session.client_id),
        client_secret: session.client_secret,
        scope,
        authorization_server: Some(session.authorization_server),
        updated_at: now,
    };

    set_oauth_token(dir, &session.plugin_name, &session.mcp_name, stored)?;
    Ok((session.plugin_name, session.mcp_name))
}

pub async fn ensure_fresh_tokens(dir: &Path, plugins: &[InstalledPlugin]) -> PluginsOAuthTokens {
    let mut tokens = match read_oauth_tokens(dir) {
        Ok(tokens) => tokens,
        Err(err) => {
            tracing::warn!("Failed to read plugin OAuth tokens: {err}");
            return BTreeMap::new();
        }
    };

    let now = now_unix();
    let mut to_refresh = Vec::new();
    for plugin in plugins {
        if !plugin.enabled {
            continue;
        }
        for mcp in &plugin.mcp {
            if !mcp.enabled || !mcp.oauth {
                continue;
            }
            if let Some(stored) = tokens
                .get(&plugin.name)
                .and_then(|by_mcp| by_mcp.get(&mcp.name))
                && stored.refresh_token.is_some()
                && stored.token_endpoint.is_some()
                && stored.client_id.is_some()
                && stored.expires_at.is_some_and(|exp| exp <= now + 120)
            {
                to_refresh.push((plugin.name.clone(), mcp.name.clone(), stored.clone()));
            }
        }
    }

    if to_refresh.is_empty() {
        return tokens;
    }

    let Ok(client) = build_http_client() else {
        return tokens;
    };

    for (plugin_name, mcp_name, stored) in to_refresh {
        let Some(token_endpoint) = stored.token_endpoint.as_deref() else {
            continue;
        };
        let Some(refresh_token) = stored.refresh_token.as_deref() else {
            continue;
        };
        let Some(client_id) = stored.client_id.as_deref() else {
            continue;
        };

        let mut form = vec![
            ("grant_type", "refresh_token".to_string()),
            ("refresh_token", refresh_token.to_string()),
            ("client_id", client_id.to_string()),
        ];
        if let Some(secret) = &stored.client_secret {
            form.push(("client_secret", secret.clone()));
        }

        let resp = match client
            .post(token_endpoint)
            .header(
                reqwest::header::CONTENT_TYPE,
                "application/x-www-form-urlencoded",
            )
            .body(encode_form(&form))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => resp,
            Ok(resp) => {
                tracing::warn!(
                    "OAuth refresh failed for {plugin_name}/{mcp_name}: HTTP {}",
                    resp.status()
                );
                continue;
            }
            Err(err) => {
                tracing::warn!("OAuth refresh failed for {plugin_name}/{mcp_name}: {err}");
                continue;
            }
        };

        let Ok(body) = resp.json::<Value>().await else {
            continue;
        };
        let Some(new_access) = body.get("access_token").and_then(Value::as_str) else {
            continue;
        };
        let new_refresh = body
            .get("refresh_token")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| stored.refresh_token.clone());
        let refreshed_at = now_unix();
        let new_expires_at = body
            .get("expires_in")
            .and_then(Value::as_i64)
            .map(|secs| refreshed_at + secs);

        let updated = StoredMcpOAuthToken {
            access_token: new_access.to_owned(),
            refresh_token: new_refresh,
            expires_at: new_expires_at,
            token_endpoint: stored.token_endpoint.clone(),
            client_id: stored.client_id.clone(),
            client_secret: stored.client_secret.clone(),
            scope: body
                .get("scope")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| stored.scope.clone()),
            authorization_server: stored.authorization_server.clone(),
            updated_at: refreshed_at,
        };

        if let Err(err) = set_oauth_token(dir, &plugin_name, &mcp_name, updated.clone()) {
            tracing::warn!("Failed to persist refreshed OAuth token: {err}");
            continue;
        }
        tokens
            .entry(plugin_name)
            .or_default()
            .insert(mcp_name, updated);
    }

    tokens
}

fn parse_mcp_jsonrpc_body(body: &str, target_id: i64) -> Option<Value> {
    if let Ok(val) = serde_json::from_str::<Value>(body) {
        if val.get("id").and_then(Value::as_i64) == Some(target_id)
            || val.get("result").is_some()
            || val.get("error").is_some()
        {
            return Some(val);
        }
    }
    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(data) = trimmed.strip_prefix("data:")
            && let Ok(val) = serde_json::from_str::<Value>(data.trim())
            && val.get("id").and_then(Value::as_i64) == Some(target_id)
        {
            return Some(val);
        }
    }
    None
}

fn extract_tools_from_response(val: &Value) -> Result<Vec<PluginMcpToolInfo>, PluginError> {
    if let Some(err) = val.get("error") {
        let msg = err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("MCP tools/list error");
        return Err(PluginError::BadRequest(msg.to_owned()));
    }
    let tools = val
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(Value::as_array)
        .ok_or_else(|| PluginError::BadRequest("MCP response missing result.tools".into()))?;
    Ok(tools
        .iter()
        .filter_map(|t| {
            let name = t.get("name")?.as_str()?.to_owned();
            let description = t
                .get("description")
                .and_then(Value::as_str)
                .map(|s| s.trim().to_owned())
                .filter(|s| !s.is_empty());
            Some(PluginMcpToolInfo { name, description })
        })
        .collect())
}

pub async fn list_mcp_tools(
    dir: &Path,
    plugin: &InstalledPlugin,
    mcp: &PluginMcpEntry,
) -> Result<Vec<PluginMcpToolInfo>, PluginError> {
    let secrets = read_plugin_secrets(dir).unwrap_or_default();
    let mcp_secrets = secrets.get(&plugin.name).and_then(|m| m.get(&mcp.name));

    if mcp.transport == "http" {
        let url = mcp
            .url
            .as_deref()
            .filter(|u| !u.trim().is_empty())
            .ok_or_else(|| PluginError::BadRequest("MCP server is missing url".into()))?;
        let client = build_http_client()?;

        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::ACCEPT,
            "application/json, text/event-stream"
                .parse()
                .expect("valid accept header"),
        );
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            "application/json".parse().expect("valid content-type"),
        );

        let mut has_auth = false;
        for (hdr_key, secret_ref) in &mcp.headers {
            if let Some(secret_val) = mcp_secrets.and_then(|m| m.get(secret_ref))
                && let Ok(name) = reqwest::header::HeaderName::from_bytes(hdr_key.as_bytes())
            {
                let formatted = if hdr_key.eq_ignore_ascii_case("authorization")
                    && !secret_val.to_ascii_lowercase().starts_with("bearer ")
                {
                    format!("Bearer {secret_val}")
                } else {
                    secret_val.clone()
                };
                if let Ok(val) = reqwest::header::HeaderValue::from_str(&formatted) {
                    if hdr_key.eq_ignore_ascii_case("authorization") {
                        has_auth = true;
                    }
                    headers.insert(name, val);
                }
            }
        }

        if mcp.oauth && !has_auth {
            let fresh_tokens = ensure_fresh_tokens(dir, std::slice::from_ref(plugin)).await;
            if let Some(token) = fresh_tokens
                .get(&plugin.name)
                .and_then(|m| m.get(&mcp.name))
                && let Ok(val) = reqwest::header::HeaderValue::from_str(&format!(
                    "Bearer {}",
                    token.access_token
                ))
            {
                headers.insert(reqwest::header::AUTHORIZATION, val);
            } else {
                return Err(PluginError::BadRequest(
                    "Chưa đăng nhập OAuth cho MCP server này.".into(),
                ));
            }
        }

        let init_payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": { "name": "HiveDeck", "version": "1.0" }
            }
        });
        let init_resp = client
            .post(url)
            .headers(headers.clone())
            .json(&init_payload)
            .send()
            .await
            .map_err(|err| {
                PluginError::BadRequest(format!("Không kết nối được tới MCP server: {err}"))
            })?;
        if !init_resp.status().is_success() {
            let status = init_resp.status();
            let text = init_resp.text().await.unwrap_or_default();
            return Err(PluginError::BadRequest(format!(
                "MCP initialize trả về HTTP {status}: {text}"
            )));
        }
        if let Some(session_id) = init_resp.headers().get("mcp-session-id").cloned() {
            headers.insert("mcp-session-id", session_id);
        }
        let _ = init_resp.text().await;

        let list_payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        });
        let list_resp = client
            .post(url)
            .headers(headers)
            .json(&list_payload)
            .send()
            .await
            .map_err(|err| PluginError::BadRequest(format!("Lỗi gọi tools/list: {err}")))?;
        let status = list_resp.status();
        let body = list_resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(PluginError::BadRequest(format!(
                "MCP tools/list trả về HTTP {status}: {body}"
            )));
        }
        let parsed = parse_mcp_jsonrpc_body(&body, 2).ok_or_else(|| {
            PluginError::BadRequest("Không đọc được JSON-RPC tools/list từ MCP server".into())
        })?;
        return extract_tools_from_response(&parsed);
    }

    if mcp.transport == "stdio" {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let command_raw = mcp
            .command
            .as_deref()
            .filter(|c| !c.trim().is_empty())
            .ok_or_else(|| PluginError::BadRequest("MCP server is missing command".into()))?;
        let root = plugin_asset_dir(dir, &plugin.name);
        let root_str = root.to_string_lossy();
        let expand = |raw: &str| {
            raw.replace("${CLAUDE_PLUGIN_ROOT}", &root_str)
                .replace("${HIVEDECK_PLUGIN_ROOT}", &root_str)
        };

        let mut cmd = tokio::process::Command::new(expand(command_raw));
        cmd.args(mcp.args.iter().map(|a| expand(a)));
        for (env_key, secret_ref) in &mcp.env {
            if let Some(val) = mcp_secrets.and_then(|m| m.get(secret_ref)) {
                cmd.env(env_key, val);
            }
        }
        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());

        let mut child = cmd.spawn().map_err(|err| {
            PluginError::BadRequest(format!(
                "Không chạy được MCP command '{command_raw}': {err}"
            ))
        })?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| PluginError::BadRequest("Failed to open MCP stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| PluginError::BadRequest("Failed to open MCP stdout".into()))?;

        let init_msg = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"clientInfo\":{\"name\":\"HiveDeck\",\"version\":\"1.0\"}}}\n{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}\n";
        let _ = stdin.write_all(init_msg.as_bytes()).await;
        let _ = stdin.flush().await;

        let mut lines = BufReader::new(stdout).lines();
        let result = tokio::time::timeout(Duration::from_secs(12), async {
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(val) = serde_json::from_str::<Value>(line.trim())
                    && val.get("id").and_then(Value::as_i64) == Some(2)
                {
                    return extract_tools_from_response(&val);
                }
            }
            Err(PluginError::BadRequest(
                "MCP stdio process closed before returning tools/list".into(),
            ))
        })
        .await;
        let _ = child.kill().await;
        return match result {
            Ok(inner) => inner,
            Err(_) => Err(PluginError::BadRequest(
                "MCP tools/list timed out sau 12 giây".into(),
            )),
        };
    }

    Err(PluginError::BadRequest(format!(
        "Unsupported MCP transport '{}'",
        mcp.transport
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn extract_resource_metadata_parses_quoted_and_unquoted() {
        assert_eq!(
            extract_resource_metadata_url(
                r#"Bearer resource_metadata="https://mcp.higgsfield.ai/.well-known/oauth-protected-resource/mcp", scope="openid""#
            ),
            Some("https://mcp.higgsfield.ai/.well-known/oauth-protected-resource/mcp".into())
        );
        assert_eq!(
            extract_resource_metadata_url(
                "Bearer resource_metadata=https://example.com/meta, scope=openid"
            ),
            Some("https://example.com/meta".into())
        );
        assert_eq!(extract_resource_metadata_url("Bearer realm=example"), None);
    }

    #[test]
    fn oauth_token_store_round_trips_with_0600_permissions() {
        let dir = TempDir::new().unwrap();
        let token = StoredMcpOAuthToken {
            access_token: "acc-123".into(),
            refresh_token: Some("ref-456".into()),
            expires_at: Some(9_999_999_999),
            token_endpoint: Some("https://auth.example.com/token".into()),
            client_id: Some("client-1".into()),
            client_secret: None,
            scope: Some("openid".into()),
            authorization_server: Some("https://auth.example.com".into()),
            updated_at: 1_700_000_000,
        };
        set_oauth_token(dir.path(), "higgsfield", "higgsfield", token).unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(oauth_tokens_path(dir.path()))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }

        let loaded = read_oauth_tokens(dir.path()).unwrap();
        assert_eq!(loaded["higgsfield"]["higgsfield"].access_token, "acc-123");
        assert!(remove_oauth_token(dir.path(), "higgsfield", "higgsfield").unwrap());
        assert!(read_oauth_tokens(dir.path()).unwrap().is_empty());
    }
}
