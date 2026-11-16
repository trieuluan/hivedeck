//! Embedded 9router endpoints (ADR-026). Settings (`auto_start`, `port`) are
//! part of `Config.nine_router` and saved through the regular config route.

use axum::{
    Router,
    extract::{Query, State},
    response::Json as ResponseJson,
    routing::{get, post},
};
use deployment::Deployment;
use serde::Deserialize;
use services::services::nine_router::{
    self, ComboSuggestions, NineRouterError, NineRouterLogs, NineRouterSettings, NineRouterStatus,
};
use ts_rs::TS;
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError};

type StatusResponse = Result<ResponseJson<ApiResponse<NineRouterStatus>>, ApiError>;

async fn settings(deployment: &DeploymentImpl) -> NineRouterSettings {
    deployment.config().read().await.nine_router.clone()
}

fn to_api_error(err: NineRouterError) -> ApiError {
    match err {
        NineRouterError::InstallInProgress
        | NineRouterError::AlreadyRunning(_)
        | NineRouterError::External(_)
        | NineRouterError::UpToDate(_) => ApiError::Conflict(err.to_string()),
        NineRouterError::Io(e) => ApiError::Io(e),
        other => ApiError::BadRequest(other.to_string()),
    }
}

async fn status_response(deployment: &DeploymentImpl) -> StatusResponse {
    let status = nine_router::status(&settings(deployment).await, false).await;
    Ok(ResponseJson(ApiResponse::success(status)))
}

#[derive(Deserialize)]
struct StatusQuery {
    /// Query npm for the latest version now instead of using the cache.
    #[serde(default)]
    check_updates: bool,
}

async fn get_status(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<StatusQuery>,
) -> StatusResponse {
    let status = nine_router::status(&settings(&deployment).await, query.check_updates).await;
    Ok(ResponseJson(ApiResponse::success(status)))
}

async fn install(State(deployment): State<DeploymentImpl>) -> StatusResponse {
    nine_router::install(&settings(&deployment).await)
        .await
        .map_err(to_api_error)?;
    status_response(&deployment).await
}

async fn start(State(deployment): State<DeploymentImpl>) -> StatusResponse {
    nine_router::start(&settings(&deployment).await)
        .await
        .map_err(to_api_error)?;
    status_response(&deployment).await
}

async fn stop(State(deployment): State<DeploymentImpl>) -> StatusResponse {
    nine_router::stop(&settings(&deployment).await)
        .await
        .map_err(to_api_error)?;
    status_response(&deployment).await
}

async fn restart(State(deployment): State<DeploymentImpl>) -> StatusResponse {
    nine_router::restart(&settings(&deployment).await)
        .await
        .map_err(to_api_error)?;
    status_response(&deployment).await
}

async fn update(State(deployment): State<DeploymentImpl>) -> StatusResponse {
    nine_router::update(&settings(&deployment).await)
        .await
        .map_err(to_api_error)?;
    status_response(&deployment).await
}

async fn rollback(State(deployment): State<DeploymentImpl>) -> StatusResponse {
    nine_router::rollback(&settings(&deployment).await)
        .await
        .map_err(to_api_error)?;
    status_response(&deployment).await
}

async fn get_suggestions(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<ComboSuggestions>>, ApiError> {
    let suggestions = nine_router::suggestions(&settings(&deployment).await)
        .await
        .map_err(to_api_error)?;
    Ok(ResponseJson(ApiResponse::success(suggestions)))
}

#[derive(Debug, Deserialize, TS)]
pub struct ApplyComboRequest {
    pub name: String,
    pub models: Vec<String>,
}

async fn apply_combo(
    State(deployment): State<DeploymentImpl>,
    axum::Json(body): axum::Json<ApplyComboRequest>,
) -> Result<ResponseJson<ApiResponse<ComboSuggestions>>, ApiError> {
    let settings = settings(&deployment).await;
    nine_router::apply_combo(&settings, &body.name, &body.models)
        .await
        .map_err(to_api_error)?;
    let suggestions = nine_router::suggestions(&settings)
        .await
        .map_err(to_api_error)?;
    Ok(ResponseJson(ApiResponse::success(suggestions)))
}

#[derive(Deserialize)]
struct LogsQuery {
    limit: Option<usize>,
}

async fn get_logs(
    Query(query): Query<LogsQuery>,
) -> Result<ResponseJson<ApiResponse<NineRouterLogs>>, ApiError> {
    let logs = nine_router::logs(query.limit.unwrap_or(300)).await;
    Ok(ResponseJson(ApiResponse::success(logs)))
}

pub(super) fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/router/status", get(get_status))
        .route("/router/logs", get(get_logs))
        .route("/router/install", post(install))
        .route("/router/start", post(start))
        .route("/router/stop", post(stop))
        .route("/router/restart", post(restart))
        .route("/router/update", post(update))
        .route("/router/rollback", post(rollback))
        .route("/router/suggestions", get(get_suggestions))
        .route("/router/combos", post(apply_combo))
}
