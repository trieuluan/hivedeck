use std::sync::OnceLock;

use axum::{
    Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, RawQuery, State},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
};
use bytes::Bytes;
use deployment::Deployment;
use futures_util::{StreamExt, stream};
use services::services::llm_inspector::SseUsageExtractor;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::DeploymentImpl;

static PROXY_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn proxy_client() -> &'static reqwest::Client {
    PROXY_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("failed to build LLM proxy reqwest client")
    })
}

pub fn router(deployment: &DeploymentImpl) -> Router {
    Router::new()
        .route("/{execution_id}/{provider}", any(proxy_root_handler))
        .route("/{execution_id}/{provider}/{*rest}", any(proxy_handler))
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .with_state(deployment.clone())
}

async fn proxy_root_handler(
    State(deployment): State<DeploymentImpl>,
    Path((execution_id, provider)): Path<(Uuid, String)>,
    RawQuery(query): RawQuery,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    forward_request(
        deployment,
        execution_id,
        provider,
        String::new(),
        query,
        method,
        headers,
        body,
    )
    .await
}

async fn proxy_handler(
    State(deployment): State<DeploymentImpl>,
    Path((execution_id, provider, rest)): Path<(Uuid, String, String)>,
    RawQuery(query): RawQuery,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    forward_request(
        deployment,
        execution_id,
        provider,
        rest,
        query,
        method,
        headers,
        body,
    )
    .await
}

fn is_hop_by_hop_request_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "host" | "content-length" | "connection" | "transfer-encoding" | "accept-encoding"
    )
}

fn is_hop_by_hop_response_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "transfer-encoding" | "content-length" | "content-encoding" | "connection"
    )
}

fn build_upstream_url(upstream_base: &str, rest: &str, query: Option<&str>) -> String {
    let base = upstream_base.trim_end_matches('/');
    let mut path = rest.trim_start_matches('/');
    // Avoid doubling `/v1/v1/...` when upstream base already ends with `/v1`
    if base.ends_with("/v1") && path.starts_with("v1/") {
        path = &path[3..];
    } else if base.ends_with("/v1") && path == "v1" {
        path = "";
    }
    let mut url = if path.is_empty() {
        base.to_string()
    } else {
        format!("{base}/{path}")
    };
    if let Some(q) = query.filter(|s| !s.is_empty()) {
        url.push('?');
        url.push_str(q);
    }
    url
}

#[allow(clippy::too_many_arguments)]
async fn forward_request(
    deployment: DeploymentImpl,
    execution_id: Uuid,
    provider: String,
    rest: String,
    query: Option<String>,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(route) = deployment
        .llm_inspector()
        .get_route(execution_id, &provider)
    else {
        return (StatusCode::NOT_FOUND, "unknown LLM proxy execution route").into_response();
    };

    if method == Method::POST && !body.is_empty() {
        deployment.llm_inspector().inspect_request_payload(
            route.session_id,
            &rest,
            &body,
            &route.upstream_label,
        );
    }

    let upstream_url = build_upstream_url(&route.upstream_base_url, &rest, query.as_deref());
    let reqwest_method = match reqwest::Method::from_bytes(method.as_str().as_bytes()) {
        Ok(m) => m,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid HTTP method").into_response(),
    };

    let mut upstream_req = proxy_client().request(reqwest_method, &upstream_url);
    for (name, value) in &headers {
        if is_hop_by_hop_request_header(name.as_str()) {
            continue;
        }
        if let (Ok(rname), Ok(rval)) = (
            reqwest::header::HeaderName::from_bytes(name.as_str().as_bytes()),
            reqwest::header::HeaderValue::from_bytes(value.as_bytes()),
        ) {
            upstream_req = upstream_req.header(rname, rval);
        }
    }
    if !body.is_empty() {
        upstream_req = upstream_req.body(body);
    }

    let upstream_resp = match upstream_req.send().await {
        Ok(resp) => resp,
        Err(err) => {
            tracing::warn!("LLM inspector proxy upstream error for {upstream_url}: {err}");
            return (
                StatusCode::BAD_GATEWAY,
                format!("LLM proxy upstream error: {err}"),
            )
                .into_response();
        }
    };

    let status =
        StatusCode::from_u16(upstream_resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);

    let mut resp_headers = HeaderMap::new();
    for (name, value) in upstream_resp.headers() {
        if is_hop_by_hop_response_header(name.as_str()) {
            continue;
        }
        if let (Ok(aname), Ok(aval)) = (
            HeaderName::from_bytes(name.as_str().as_bytes()),
            HeaderValue::from_bytes(value.as_bytes()),
        ) {
            resp_headers.insert(aname, aval);
        }
    }

    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(64);
    let inspector = deployment.llm_inspector().clone();
    let pool = deployment.db().pool.clone();
    let session_id = route.session_id;

    tokio::spawn(async move {
        let mut stream = upstream_resp.bytes_stream();
        let mut extractor = SseUsageExtractor::default();
        while let Some(item) = stream.next().await {
            match item {
                Ok(chunk) => {
                    extractor.push_bytes(&chunk);
                    if tx.send(Ok(chunk)).await.is_err() {
                        break;
                    }
                }
                Err(err) => {
                    let _ = tx.send(Err(std::io::Error::other(err.to_string()))).await;
                    break;
                }
            }
        }
        extractor.finish();
        inspector.record_response_usage(session_id, extractor.snapshot);
        if let Some(telemetry) = inspector.get_session_telemetry(session_id)
            && let Ok(payload) = serde_json::to_string(&telemetry)
            && let Err(err) =
                db::models::session::Session::upsert_context_breakdown(&pool, session_id, &payload)
                    .await
        {
            tracing::warn!("Failed to persist context breakdown for session {session_id}: {err}");
        }
    });

    let rx_stream = stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|item| (item, rx))
    });
    let mut response = Response::new(Body::from_stream(rx_stream));
    *response.status_mut() = status;
    *response.headers_mut() = resp_headers;
    response
}
