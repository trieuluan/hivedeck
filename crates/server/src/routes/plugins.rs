use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

use axum::{
    Extension, Json, Router,
    extract::{Path as RoutePath, Query},
    http::{HeaderMap, StatusCode},
    response::Html,
    routing::{get, post, put},
};
use executors::{
    mcp_oauth::{self, PluginMcpOAuthStatus, PluginMcpToolInfo, PluginsOAuthTokens},
    plugins::{
        self, InstallPluginRequest, InstalledPlugin, PluginError, PluginMcpEntry, PluginSkillEntry,
        PluginsSecrets, UpgradePluginRequest,
    },
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Serialize, TS)]
pub struct PluginMcpSecretStatus {
    pub mcp: String,
    pub name: String,
    pub has_value: bool,
}

#[derive(Debug, Serialize, TS)]
pub struct PluginView {
    #[serde(flatten)]
    pub plugin: InstalledPlugin,
    pub secret_status: Vec<PluginMcpSecretStatus>,
    pub oauth_status: Vec<PluginMcpOAuthStatus>,
    pub skill_descriptions: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct StartPluginOAuthRequest {
    #[serde(default)]
    pub redirect_uri: Option<String>,
}

#[derive(Debug, Serialize, TS)]
pub struct StartPluginOAuthResponse {
    pub authorize_url: String,
}

#[derive(Debug, Deserialize)]
pub struct OAuthCallbackQuery {
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub error_description: Option<String>,
}

#[derive(Debug, Serialize, TS)]
pub struct PluginSecretStatus {
    pub plugin: String,
    pub mcp: String,
    pub name: String,
    pub has_value: bool,
}

#[derive(Debug, Deserialize, TS)]
pub struct SetPluginSecretRequest {
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePluginSkillRequest {
    #[serde(default)]
    pub roles: Option<Vec<String>>,
    #[serde(default)]
    pub boards: Option<Vec<String>>,
    #[serde(default)]
    pub clis: Option<Vec<String>>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub injection_mode: Option<plugins::McpInjectionMode>,
}

#[derive(Debug, Deserialize)]
pub struct SetPluginInjectionModeRequest {
    pub injection_mode: plugins::McpInjectionMode,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePluginMcpRequest {
    #[serde(default)]
    pub roles: Option<Vec<String>>,
    #[serde(default)]
    pub boards: Option<Vec<String>>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub injection_mode: Option<plugins::McpInjectionMode>,
    #[serde(default)]
    pub tool_policies: Option<BTreeMap<String, plugins::McpToolPolicy>>,
    #[serde(default)]
    pub instructions: Option<String>,
}

fn map_err(err: PluginError) -> ApiError {
    match err {
        PluginError::BadRequest(msg) => ApiError::BadRequest(msg),
        PluginError::NotFound(msg) => ApiError::NotFound(msg),
        PluginError::ConflictMessage(msg) => ApiError::Conflict(msg),
        PluginError::Conflict(conflicts) => ApiError::ConflictPayload(serde_json::json!({
            "error": "plugin_conflict",
            "conflicts": conflicts,
        })),
        PluginError::Io(io_err) => ApiError::Io(io_err),
    }
}

fn build_view(
    dir: &Path,
    plugin: InstalledPlugin,
    secrets: &PluginsSecrets,
    oauth_tokens: &PluginsOAuthTokens,
) -> PluginView {
    let mut secret_status = Vec::new();
    let mut oauth_status = Vec::new();
    for mcp in &plugin.mcp {
        let mut refs = BTreeSet::new();
        for value in mcp.headers.values().chain(mcp.env.values()) {
            refs.insert(value.clone());
        }
        let configured = secrets
            .get(&plugin.name)
            .and_then(|by_mcp| by_mcp.get(&mcp.name));
        for secret_ref in refs {
            let has_value = configured.is_some_and(|map| map.contains_key(&secret_ref));
            secret_status.push(PluginMcpSecretStatus {
                mcp: mcp.name.clone(),
                name: secret_ref,
                has_value,
            });
        }
        if mcp.oauth || mcp.transport == "http" {
            let token = oauth_tokens
                .get(&plugin.name)
                .and_then(|by_mcp| by_mcp.get(&mcp.name));
            oauth_status.push(PluginMcpOAuthStatus {
                mcp: mcp.name.clone(),
                connected: token.is_some(),
                expires_at: token.and_then(|t| t.expires_at),
                authorization_server: token.and_then(|t| t.authorization_server.clone()),
                has_refresh_token: token.is_some_and(|t| t.refresh_token.is_some()),
            });
        }
    }
    let skill_descriptions = plugins::read_plugin_skill_descriptions(dir, &plugin);
    PluginView {
        plugin,
        secret_status,
        oauth_status,
        skill_descriptions,
    }
}

async fn list(
    Extension(dir): Extension<PathBuf>,
) -> Result<Json<ApiResponse<Vec<PluginView>>>, ApiError> {
    let plugins = plugins::read_plugins(&dir).map_err(map_err)?;
    let secrets = plugins::read_plugin_secrets(&dir).map_err(map_err)?;
    let oauth_tokens = mcp_oauth::read_oauth_tokens(&dir).map_err(map_err)?;
    Ok(Json(ApiResponse::success(
        plugins
            .into_iter()
            .map(|plugin| build_view(&dir, plugin, &secrets, &oauth_tokens))
            .collect(),
    )))
}

async fn compatibility() -> Json<ApiResponse<Vec<plugins::ExecutorCompatibility>>> {
    Json(ApiResponse::success(plugins::executor_compatibility()))
}

async fn get_one(
    Extension(dir): Extension<PathBuf>,
    RoutePath(name): RoutePath<String>,
) -> Result<Json<ApiResponse<PluginView>>, ApiError> {
    if !plugins::valid_name(&name) {
        return Err(ApiError::BadRequest("Invalid plugin name".into()));
    }
    let plugins = plugins::read_plugins(&dir).map_err(map_err)?;
    let plugin = plugins
        .into_iter()
        .find(|p| p.name == name)
        .ok_or_else(|| ApiError::NotFound(format!("Plugin '{name}' not found")))?;
    let secrets = plugins::read_plugin_secrets(&dir).map_err(map_err)?;
    let oauth_tokens = mcp_oauth::read_oauth_tokens(&dir).map_err(map_err)?;
    Ok(Json(ApiResponse::success(build_view(
        &dir,
        plugin,
        &secrets,
        &oauth_tokens,
    ))))
}

async fn install(
    Extension(dir): Extension<PathBuf>,
    req: Result<Json<InstallPluginRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ApiResponse<PluginView>>, ApiError> {
    let Json(req) = req.map_err(|_| ApiError::BadRequest("Invalid install request".into()))?;
    let installed = plugins::install_plugin(&dir, req).map_err(map_err)?;
    mcp_oauth::spawn_background_instruction_probe(dir.clone(), vec![installed.clone()]);
    let secrets = plugins::read_plugin_secrets(&dir).map_err(map_err)?;
    let oauth_tokens = mcp_oauth::read_oauth_tokens(&dir).map_err(map_err)?;
    Ok(Json(ApiResponse::success(build_view(
        &dir,
        installed,
        &secrets,
        &oauth_tokens,
    ))))
}

async fn preview(
    req: Result<Json<InstallPluginRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ApiResponse<InstalledPlugin>>, ApiError> {
    let Json(req) = req.map_err(|_| ApiError::BadRequest("Invalid preview request".into()))?;
    let plugin = tokio::task::spawn_blocking(move || plugins::preview_plugin(req))
        .await
        .map_err(|err| ApiError::Io(std::io::Error::other(err)))?
        .map_err(map_err)?;
    Ok(Json(ApiResponse::success(plugin)))
}

async fn latest_tag(
    Extension(dir): Extension<PathBuf>,
    RoutePath(name): RoutePath<String>,
) -> Result<Json<ApiResponse<Option<String>>>, ApiError> {
    if !plugins::valid_name(&name) {
        return Err(ApiError::BadRequest("Invalid plugin name".into()));
    }
    let tag = tokio::task::spawn_blocking(move || plugins::latest_tag(&dir, &name))
        .await
        .map_err(|err| ApiError::Io(std::io::Error::other(err)))?
        .map_err(map_err)?;
    Ok(Json(ApiResponse::success(tag)))
}

async fn upgrade(
    Extension(dir): Extension<PathBuf>,
    RoutePath(name): RoutePath<String>,
    req: Option<Json<UpgradePluginRequest>>,
) -> Result<Json<ApiResponse<PluginView>>, ApiError> {
    let req = req.map(|Json(val)| val).unwrap_or_default();
    let updated = plugins::upgrade_plugin(&dir, &name, req).map_err(map_err)?;
    let secrets = plugins::read_plugin_secrets(&dir).map_err(map_err)?;
    let oauth_tokens = mcp_oauth::read_oauth_tokens(&dir).map_err(map_err)?;
    Ok(Json(ApiResponse::success(build_view(
        &dir,
        updated,
        &secrets,
        &oauth_tokens,
    ))))
}

async fn uninstall(
    Extension(dir): Extension<PathBuf>,
    RoutePath(name): RoutePath<String>,
) -> Result<StatusCode, ApiError> {
    plugins::uninstall_plugin(&dir, &name).map_err(map_err)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn enable(
    Extension(dir): Extension<PathBuf>,
    RoutePath(name): RoutePath<String>,
) -> Result<Json<ApiResponse<PluginView>>, ApiError> {
    let updated = plugins::set_plugin_enabled(&dir, &name, true).map_err(map_err)?;
    let secrets = plugins::read_plugin_secrets(&dir).map_err(map_err)?;
    let oauth_tokens = mcp_oauth::read_oauth_tokens(&dir).map_err(map_err)?;
    Ok(Json(ApiResponse::success(build_view(
        &dir,
        updated,
        &secrets,
        &oauth_tokens,
    ))))
}

async fn disable(
    Extension(dir): Extension<PathBuf>,
    RoutePath(name): RoutePath<String>,
) -> Result<Json<ApiResponse<PluginView>>, ApiError> {
    let updated = plugins::set_plugin_enabled(&dir, &name, false).map_err(map_err)?;
    let secrets = plugins::read_plugin_secrets(&dir).map_err(map_err)?;
    let oauth_tokens = mcp_oauth::read_oauth_tokens(&dir).map_err(map_err)?;
    Ok(Json(ApiResponse::success(build_view(
        &dir,
        updated,
        &secrets,
        &oauth_tokens,
    ))))
}

async fn set_injection_mode(
    Extension(dir): Extension<PathBuf>,
    RoutePath(name): RoutePath<String>,
    req: Result<Json<SetPluginInjectionModeRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ApiResponse<PluginView>>, ApiError> {
    let Json(req) =
        req.map_err(|_| ApiError::BadRequest("Invalid injection mode request".into()))?;
    let updated =
        plugins::set_plugin_injection_mode(&dir, &name, req.injection_mode).map_err(map_err)?;
    let secrets = plugins::read_plugin_secrets(&dir).map_err(map_err)?;
    let oauth_tokens = mcp_oauth::read_oauth_tokens(&dir).map_err(map_err)?;
    Ok(Json(ApiResponse::success(build_view(
        &dir,
        updated,
        &secrets,
        &oauth_tokens,
    ))))
}

async fn get_skill_content(
    Extension(dir): Extension<PathBuf>,
    RoutePath((name, skill)): RoutePath<(String, String)>,
) -> Result<Json<ApiResponse<plugins::PluginSkillContent>>, ApiError> {
    let content = plugins::read_plugin_skill_content(&dir, &name, &skill).map_err(map_err)?;
    Ok(Json(ApiResponse::success(content)))
}

async fn update_skill(
    Extension(dir): Extension<PathBuf>,
    RoutePath((name, skill)): RoutePath<(String, String)>,
    req: Result<Json<UpdatePluginSkillRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ApiResponse<PluginSkillEntry>>, ApiError> {
    let Json(req) = req.map_err(|_| ApiError::BadRequest("Invalid skill update request".into()))?;
    let updated = plugins::update_skill_scope(
        &dir,
        &name,
        &skill,
        req.roles,
        req.boards,
        req.clis,
        req.enabled,
        req.injection_mode,
    )
    .map_err(map_err)?;
    Ok(Json(ApiResponse::success(updated)))
}

async fn update_mcp(
    Extension(dir): Extension<PathBuf>,
    RoutePath((name, mcp)): RoutePath<(String, String)>,
    req: Result<Json<UpdatePluginMcpRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ApiResponse<PluginMcpEntry>>, ApiError> {
    let Json(req) = req.map_err(|_| ApiError::BadRequest("Invalid MCP update request".into()))?;
    let updated = plugins::update_mcp_scope(
        &dir,
        &name,
        &mcp,
        req.roles,
        req.boards,
        req.enabled,
        req.injection_mode,
        req.tool_policies,
        req.instructions,
    )
    .map_err(map_err)?;
    Ok(Json(ApiResponse::success(updated)))
}

async fn secret_status(
    Extension(dir): Extension<PathBuf>,
    RoutePath((plugin, mcp, secret)): RoutePath<(String, String, String)>,
) -> Result<Json<ApiResponse<PluginSecretStatus>>, ApiError> {
    if !plugins::valid_name(&plugin) || !plugins::valid_name(&mcp) || !plugins::valid_name(&secret)
    {
        return Err(ApiError::BadRequest("Invalid secret identifier".into()));
    }
    let secrets = plugins::read_plugin_secrets(&dir).map_err(map_err)?;
    let has_value = secrets
        .get(&plugin)
        .and_then(|by_mcp| by_mcp.get(&mcp))
        .is_some_and(|map| map.contains_key(&secret));
    Ok(Json(ApiResponse::success(PluginSecretStatus {
        plugin,
        mcp,
        name: secret,
        has_value,
    })))
}

async fn set_secret(
    Extension(dir): Extension<PathBuf>,
    RoutePath((plugin, mcp, secret)): RoutePath<(String, String, String)>,
    body: Result<Json<SetPluginSecretRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ApiResponse<PluginSecretStatus>>, ApiError> {
    let Json(body) = body.map_err(|_| ApiError::BadRequest("Invalid secret payload".into()))?;
    let has_value = plugins::set_plugin_mcp_secret(&dir, &plugin, &mcp, &secret, Some(body.value))
        .map_err(map_err)?;
    Ok(Json(ApiResponse::success(PluginSecretStatus {
        plugin,
        mcp,
        name: secret,
        has_value,
    })))
}

async fn clear_secret(
    Extension(dir): Extension<PathBuf>,
    RoutePath((plugin, mcp, secret)): RoutePath<(String, String, String)>,
) -> Result<Json<ApiResponse<PluginSecretStatus>>, ApiError> {
    let has_value =
        plugins::set_plugin_mcp_secret(&dir, &plugin, &mcp, &secret, None).map_err(map_err)?;
    Ok(Json(ApiResponse::success(PluginSecretStatus {
        plugin,
        mcp,
        name: secret,
        has_value,
    })))
}

fn resolve_redirect_uri(headers: &HeaderMap, requested: Option<String>) -> String {
    if let Some(uri) = requested
        .map(|s| s.trim().to_owned())
        .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
    {
        return uri;
    }
    if let Some(origin) = headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
    {
        return format!(
            "{}/api/plugins/oauth/callback",
            origin.trim_end_matches('/')
        );
    }
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost:3002");
    format!("http://{host}/api/plugins/oauth/callback")
}

async fn start_oauth(
    Extension(dir): Extension<PathBuf>,
    RoutePath((plugin_name, mcp_name)): RoutePath<(String, String)>,
    headers: HeaderMap,
    req: Option<Json<StartPluginOAuthRequest>>,
) -> Result<Json<ApiResponse<StartPluginOAuthResponse>>, ApiError> {
    if !plugins::valid_name(&plugin_name) || !plugins::valid_name(&mcp_name) {
        return Err(ApiError::BadRequest(
            "Invalid plugin or MCP identifier".into(),
        ));
    }
    let plugins_list = plugins::read_plugins(&dir).map_err(map_err)?;
    let plugin = plugins_list
        .into_iter()
        .find(|p| p.name == plugin_name)
        .ok_or_else(|| ApiError::NotFound(format!("Plugin '{plugin_name}' not found")))?;
    let mcp = plugin
        .mcp
        .into_iter()
        .find(|m| m.name == mcp_name)
        .ok_or_else(|| ApiError::NotFound(format!("MCP '{mcp_name}' not found")))?;
    if mcp.transport != "http" {
        return Err(ApiError::BadRequest(
            "OAuth is only supported for HTTP MCP servers".into(),
        ));
    }
    let url = mcp
        .url
        .as_deref()
        .filter(|u| !u.trim().is_empty())
        .ok_or_else(|| ApiError::BadRequest("MCP server is missing url".into()))?;
    let redirect_uri = resolve_redirect_uri(&headers, req.and_then(|Json(r)| r.redirect_uri));
    let authorize_url = mcp_oauth::start_oauth_flow(&plugin_name, &mcp_name, url, &redirect_uri)
        .await
        .map_err(map_err)?;
    Ok(Json(ApiResponse::success(StartPluginOAuthResponse {
        authorize_url,
    })))
}

fn oauth_popup_html(
    ok: bool,
    title: &str,
    detail: &str,
    payload: serde_json::Value,
) -> Html<String> {
    let accent = if ok { "#22c55e" } else { "#ef4444" };
    let payload_json = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into());
    Html(format!(
        r#"<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>HiveDeck MCP OAuth</title>
<style>
  body {{ margin:0; font-family: -apple-system, BlinkMacSystemFont, "IBM Plex Sans", sans-serif; background:#141414; color:#f5f5f5; display:flex; align-items:center; justify-content:center; min-height:100vh; }}
  .card {{ max-width:420px; width:90%; background:#1c1c1c; border:1px solid #2b2b2b; border-radius:8px; padding:24px; text-align:center; }}
  .dot {{ width:12px; height:12px; border-radius:999px; background:{accent}; display:inline-block; margin-bottom:12px; }}
  h1 {{ font-size:16px; margin:0 0 8px; }}
  p {{ font-size:13px; color:#a3a3a3; line-height:1.5; margin:0; word-break:break-word; }}
</style>
</head>
<body>
  <div class="card">
    <span class="dot"></span>
    <h1>{title}</h1>
    <p>{detail}</p>
  </div>
  <script>
    try {{
      if (window.opener) {{
        window.opener.postMessage({payload_json}, "*");
      }}
    }} catch (_) {{}}
    if ({ok}) {{
      setTimeout(function() {{ window.close(); }}, 500);
    }}
  </script>
</body>
</html>"#
    ))
}

async fn oauth_callback(
    Extension(dir): Extension<PathBuf>,
    Query(query): Query<OAuthCallbackQuery>,
) -> Html<String> {
    if let Some(err) = query.error {
        let detail = query.error_description.unwrap_or(err);
        return oauth_popup_html(
            false,
            "Xác thực OAuth thất bại",
            &detail,
            serde_json::json!({
                "type": "hivedeck-mcp-oauth-complete",
                "ok": false,
                "error": detail,
            }),
        );
    }
    let (Some(state), Some(code)) = (query.state, query.code) else {
        return oauth_popup_html(
            false,
            "Thiếu mã xác thực OAuth",
            "Callback không chứa tham số code hoặc state.",
            serde_json::json!({
                "type": "hivedeck-mcp-oauth-complete",
                "ok": false,
                "error": "Missing code or state",
            }),
        );
    };
    match mcp_oauth::complete_oauth_callback(&dir, &state, &code).await {
        Ok((plugin, mcp)) => oauth_popup_html(
            true,
            "Đã kết nối OAuth thành công",
            "Token đã được lưu vào HiveDeck và tự động cấp cho toàn bộ CLI. Cửa sổ này sẽ tự đóng.",
            serde_json::json!({
                "type": "hivedeck-mcp-oauth-complete",
                "ok": true,
                "plugin": plugin,
                "mcp": mcp,
            }),
        ),
        Err(err) => {
            let msg = err.to_string();
            oauth_popup_html(
                false,
                "Không thể hoàn tất OAuth",
                &msg,
                serde_json::json!({
                    "type": "hivedeck-mcp-oauth-complete",
                    "ok": false,
                    "error": msg,
                }),
            )
        }
    }
}

async fn list_mcp_tools(
    Extension(dir): Extension<PathBuf>,
    RoutePath((plugin_name, mcp_name)): RoutePath<(String, String)>,
) -> Result<Json<ApiResponse<Vec<PluginMcpToolInfo>>>, ApiError> {
    if !plugins::valid_name(&plugin_name) || !plugins::valid_name(&mcp_name) {
        return Err(ApiError::BadRequest(
            "Invalid plugin or MCP identifier".into(),
        ));
    }
    let plugins_list = plugins::read_plugins(&dir).map_err(map_err)?;
    let plugin = plugins_list
        .into_iter()
        .find(|p| p.name == plugin_name)
        .ok_or_else(|| ApiError::NotFound(format!("Plugin '{plugin_name}' not found")))?;
    let mcp = plugin
        .mcp
        .iter()
        .find(|m| m.name == mcp_name)
        .cloned()
        .ok_or_else(|| ApiError::NotFound(format!("MCP '{mcp_name}' not found")))?;
    let probed = mcp_oauth::probe_mcp_server(&dir, &plugin, &mcp)
        .await
        .map_err(map_err)?;
    if probed.instructions.is_some() && probed.instructions != mcp.server_instructions {
        let _ = plugins::update_mcp_server_instructions(
            &dir,
            &plugin_name,
            &mcp_name,
            probed.instructions,
        );
    }
    Ok(Json(ApiResponse::success(probed.tools)))
}

async fn disconnect_oauth(
    Extension(dir): Extension<PathBuf>,
    RoutePath((plugin, mcp)): RoutePath<(String, String)>,
) -> Result<Json<ApiResponse<PluginMcpOAuthStatus>>, ApiError> {
    if !plugins::valid_name(&plugin) || !plugins::valid_name(&mcp) {
        return Err(ApiError::BadRequest(
            "Invalid plugin or MCP identifier".into(),
        ));
    }
    mcp_oauth::remove_oauth_token(&dir, &plugin, &mcp).map_err(map_err)?;
    Ok(Json(ApiResponse::success(PluginMcpOAuthStatus {
        mcp,
        connected: false,
        expires_at: None,
        authorization_server: None,
        has_refresh_token: false,
    })))
}

pub(crate) fn router_for_dir<S: Clone + Send + Sync + 'static>(dir: &Path) -> Router<S> {
    Router::new()
        .route("/plugins", get(list))
        .route("/plugins/compatibility", get(compatibility))
        .route("/plugins/install", post(install))
        .route("/plugins/preview", post(preview))
        .route("/plugins/oauth/callback", get(oauth_callback))
        .route("/plugins/{name}", get(get_one).delete(uninstall))
        .route("/plugins/{name}/enable", post(enable))
        .route("/plugins/{name}/disable", post(disable))
        .route("/plugins/{name}/injection-mode", put(set_injection_mode))
        .route("/plugins/{name}/upgrade", post(upgrade))
        .route("/plugins/{name}/latest-tag", get(latest_tag))
        .route("/plugins/{name}/skills/{skill}", put(update_skill))
        .route(
            "/plugins/{name}/skills/{skill}/content",
            get(get_skill_content),
        )
        .route("/plugins/{name}/mcp/{mcp}", put(update_mcp))
        .route("/plugins/{name}/mcp/{mcp}/tools", get(list_mcp_tools))
        .route("/plugins/{name}/mcp/{mcp}/oauth/start", post(start_oauth))
        .route(
            "/plugins/{name}/mcp/{mcp}/oauth",
            axum::routing::delete(disconnect_oauth),
        )
        .route(
            "/plugins/{name}/mcp/{mcp}/secrets/{secret}",
            get(secret_status).put(set_secret).delete(clear_secret),
        )
        .layer(Extension(dir.to_path_buf()))
}

pub(super) fn router() -> Router<DeploymentImpl> {
    router_for_dir(&utils::assets::asset_dir())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;

    async fn request(app: &Router, method: &str, uri: &str, body: &str) -> (StatusCode, String) {
        let builder = Request::builder().method(method).uri(uri);
        let req = if body.is_empty() {
            builder.body(Body::empty()).unwrap()
        } else {
            builder
                .header("content-type", "application/json")
                .body(Body::from(body.to_owned()))
                .unwrap()
        };
        let resp = app.clone().oneshot(req).await.unwrap();
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, String::from_utf8(bytes.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn compatibility_route_lists_executors() {
        let dir = tempfile::tempdir().unwrap();
        let app = router_for_dir::<()>(dir.path());
        let (status, body) = request(&app, "GET", "/plugins/compatibility", "").await;
        assert_eq!(status, StatusCode::OK);
        let body: serde_json::Value = serde_json::from_str(&body).unwrap();
        let rows = body["data"].as_array().unwrap();
        assert_eq!(rows.len(), plugins::executor_compatibility().len());
        for entry in plugins::executor_compatibility() {
            assert!(rows.contains(&serde_json::to_value(entry).unwrap()));
        }
    }

    #[tokio::test]
    async fn plugin_api_crud_secrets_conflicts_and_cleanup() {
        let dir = tempfile::tempdir().unwrap();
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../executors/tests/fixtures/sample-plugin");
        let app = router_for_dir::<()>(dir.path());

        let preview_body = serde_json::json!({ "source": fixture.to_string_lossy() }).to_string();
        let (status, body) = request(&app, "POST", "/plugins/preview", &preview_body).await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("sample-plugin"));
        let (status, body) = request(&app, "GET", "/plugins", "").await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("\"data\":[]"), "preview must not install");

        // Initially empty.
        let (status, body) = request(&app, "GET", "/plugins", "").await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("\"data\":[]"));

        // Seed colliding mcp_registry entry to verify conflict detection + overwrite.
        std::fs::write(
            dir.path().join("mcp_registry.json"),
            r#"[{"name":"fixture-tool","transport":"stdio","command":"old","args":[],"roles":["crew"],"boards":[]}]"#,
        )
        .unwrap();

        let install_body = serde_json::json!({
            "source": fixture.to_string_lossy(),
            "version": "1.0.0"
        })
        .to_string();
        let (status, body) = request(&app, "POST", "/plugins/install", &install_body).await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert!(body.contains("plugin_conflict"));
        assert!(body.contains("mcp_registry"));

        // Overwrite policy succeeds and records conflict note.
        let install_overwrite = serde_json::json!({
            "source": fixture.to_string_lossy(),
            "version": "1.0.0",
            "conflict_policy": "overwrite"
        })
        .to_string();
        let (status, body) = request(&app, "POST", "/plugins/install", &install_overwrite).await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("sample-plugin"));
        assert!(body.contains("\"has_value\":false"));
        assert!(body.contains("\"hooks\""));

        // Set secret -> 0600 file, never returned in response or GET.
        let (status, body) = request(
            &app,
            "PUT",
            "/plugins/sample-plugin/mcp/fixture-tool/secrets/FIXTURE_API_KEY",
            r#"{"value":"super-secret-token"}"#,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("\"has_value\":true"));
        assert!(!body.contains("super-secret-token"));

        let (status, body) = request(&app, "GET", "/plugins/sample-plugin", "").await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("\"has_value\":true"));
        assert!(!body.contains("super-secret-token"));

        // Update skill scope & CLI targets.
        let (status, body) = request(
            &app,
            "PUT",
            "/plugins/sample-plugin/skills/fixture-skill",
            r#"{"roles":["captain","crew"],"boards":["board-9"],"clis":["claude_code","opencode"]}"#,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("board-9"));
        assert!(body.contains("opencode"));

        // Disable & enable.
        let (status, body) = request(&app, "POST", "/plugins/sample-plugin/disable", "").await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("\"enabled\":false"));
        let (status, body) = request(&app, "POST", "/plugins/sample-plugin/enable", "").await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("\"enabled\":true"));

        // Clear secret & uninstall.
        let (status, body) = request(
            &app,
            "DELETE",
            "/plugins/sample-plugin/mcp/fixture-tool/secrets/FIXTURE_API_KEY",
            "",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("\"has_value\":false"));

        let (status, _) = request(&app, "DELETE", "/plugins/sample-plugin", "").await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (status, _) = request(&app, "GET", "/plugins/sample-plugin", "").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(fixture.join(".claude-plugin/plugin.json").is_file());
    }
}
