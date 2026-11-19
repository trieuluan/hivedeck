use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

use axum::{
    Extension, Json, Router,
    extract::Path as RoutePath,
    http::StatusCode,
    routing::{get, post, put},
};
use executors::plugins::{
    self, InstallPluginRequest, InstalledPlugin, PluginError, PluginMcpEntry, PluginSkillEntry,
    PluginsSecrets, UpgradePluginRequest,
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
}

#[derive(Debug, Deserialize)]
pub struct UpdatePluginMcpRequest {
    #[serde(default)]
    pub roles: Option<Vec<String>>,
    #[serde(default)]
    pub boards: Option<Vec<String>>,
    #[serde(default)]
    pub enabled: Option<bool>,
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

fn build_view(plugin: InstalledPlugin, secrets: &PluginsSecrets) -> PluginView {
    let mut secret_status = Vec::new();
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
    }
    PluginView {
        plugin,
        secret_status,
    }
}

async fn list(
    Extension(dir): Extension<PathBuf>,
) -> Result<Json<ApiResponse<Vec<PluginView>>>, ApiError> {
    let plugins = plugins::read_plugins(&dir).map_err(map_err)?;
    let secrets = plugins::read_plugin_secrets(&dir).map_err(map_err)?;
    Ok(Json(ApiResponse::success(
        plugins
            .into_iter()
            .map(|plugin| build_view(plugin, &secrets))
            .collect(),
    )))
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
    Ok(Json(ApiResponse::success(build_view(plugin, &secrets))))
}

async fn install(
    Extension(dir): Extension<PathBuf>,
    req: Result<Json<InstallPluginRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<ApiResponse<PluginView>>, ApiError> {
    let Json(req) = req.map_err(|_| ApiError::BadRequest("Invalid install request".into()))?;
    let installed = plugins::install_plugin(&dir, req).map_err(map_err)?;
    let secrets = plugins::read_plugin_secrets(&dir).map_err(map_err)?;
    Ok(Json(ApiResponse::success(build_view(installed, &secrets))))
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
    Ok(Json(ApiResponse::success(build_view(updated, &secrets))))
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
    Ok(Json(ApiResponse::success(build_view(updated, &secrets))))
}

async fn disable(
    Extension(dir): Extension<PathBuf>,
    RoutePath(name): RoutePath<String>,
) -> Result<Json<ApiResponse<PluginView>>, ApiError> {
    let updated = plugins::set_plugin_enabled(&dir, &name, false).map_err(map_err)?;
    let secrets = plugins::read_plugin_secrets(&dir).map_err(map_err)?;
    Ok(Json(ApiResponse::success(build_view(updated, &secrets))))
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
    let updated = plugins::update_mcp_scope(&dir, &name, &mcp, req.roles, req.boards, req.enabled)
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

pub(crate) fn router_for_dir<S: Clone + Send + Sync + 'static>(dir: &Path) -> Router<S> {
    Router::new()
        .route("/plugins", get(list))
        .route("/plugins/install", post(install))
        .route("/plugins/preview", post(preview))
        .route("/plugins/{name}", get(get_one).delete(uninstall))
        .route("/plugins/{name}/enable", post(enable))
        .route("/plugins/{name}/disable", post(disable))
        .route("/plugins/{name}/upgrade", post(upgrade))
        .route("/plugins/{name}/latest-tag", get(latest_tag))
        .route("/plugins/{name}/skills/{skill}", put(update_skill))
        .route("/plugins/{name}/mcp/{mcp}", put(update_mcp))
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
