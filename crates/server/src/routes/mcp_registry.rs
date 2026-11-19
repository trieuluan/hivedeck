use std::time::Duration;

use axum::{Json, Router, extract::Query, http::StatusCode, routing::get};
use serde::Deserialize;
use serde_json::{Value, json};
use utils::response::ApiResponse;

use crate::DeploymentImpl;

#[derive(Deserialize)]
struct Search {
    q: String,
    cursor: Option<String>,
}

async fn search_registry(base: &str, search: &Search) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client.get(base).query(&[
        ("search", &search.q),
        ("limit", &"30".to_string()),
        ("version", &"latest".to_string()),
    ]);
    if let Some(cursor) = &search.cursor {
        request = request.query(&[("cursor", cursor)]);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("MCP Registry unavailable: {error}"))?
        .error_for_status()
        .map_err(|error| format!("MCP Registry error: {error}"))?;
    let data: Value = response
        .json()
        .await
        .map_err(|error| format!("Invalid MCP Registry response: {error}"))?;
    let servers = data
        .get("servers")
        .and_then(Value::as_array)
        .ok_or("Invalid MCP Registry response: missing servers")?;
    let servers: Vec<Value> = servers.iter().filter_map(|entry| {
        let server = entry.get("server")?;
        Some(json!({
            "name": server.get("name")?,
            "description": server.get("description"),
            "repository": server.pointer("/repository/url"),
            "packages": server.get("packages").and_then(Value::as_array).map(|packages| packages.iter().filter(|package| matches!(package.get("registryType").and_then(Value::as_str), Some("npm" | "pypi" | "oci"))).map(|package| json!({
                "registryType": package.get("registryType"), "identifier": package.get("identifier"), "version": package.get("version"),
                "runtimeArguments": package.get("runtimeArguments"), "packageArguments": package.get("packageArguments"), "environmentVariables": package.get("environmentVariables"),
            })).collect::<Vec<_>>()).unwrap_or_default(),
            "remotes": server.get("remotes").and_then(Value::as_array).map(|remotes| remotes.iter().map(|remote| json!({"type": remote.get("type"), "url": remote.get("url"), "headers": remote.get("headers")})).collect::<Vec<_>>()).unwrap_or_default(),
        }))
    }).collect();
    Ok(json!({"servers": servers, "nextCursor": data.pointer("/metadata/nextCursor")}))
}

async fn search(
    Query(query): Query<Search>,
) -> Result<Json<ApiResponse<Value>>, (StatusCode, Json<Value>)> {
    search_registry(
        "https://registry.modelcontextprotocol.io/v0.1/servers",
        &query,
    )
    .await
    .map(|data| Json(ApiResponse::success(data)))
    .map_err(|message| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({"success": false, "message": message})),
        )
    })
}

pub(super) fn router() -> Router<DeploymentImpl> {
    Router::new().route("/mcp-registry/servers", get(search))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn searches_registry_and_reports_errors() {
        let app = Router::new().route(
            "/servers",
            get(|Query(query): Query<std::collections::HashMap<String, String>>| async move {
                assert_eq!(query.get("search").map(String::as_str), Some("playwright"));
                assert_eq!(query.get("cursor").map(String::as_str), Some("next"));
                Json(json!({"servers": [{"server": {"name": "test/server", "packages": [{"registryType": "npm", "identifier": "example", "version": "1"}]} }], "metadata": {"nextCursor": "later"}}))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let query = Search {
            q: "playwright".into(),
            cursor: Some("next".into()),
        };
        let result = search_registry(&format!("http://{address}/servers"), &query)
            .await
            .unwrap();
        assert_eq!(result["servers"][0]["packages"][0]["identifier"], "example");
        assert_eq!(result["nextCursor"], "later");
        assert!(
            search_registry(&format!("http://{address}/missing"), &query)
                .await
                .is_err()
        );
        task.abort();
    }
}
