//! The HiveDeck MCP server over streamable HTTP at `/mcp` (ADR-030).
//!
//! Serves the same global-mode tool surface as the `hivedeck-mcp` stdio
//! binary, so the captain (and any MCP client) can connect with a URL instead
//! of a separate binary. Stateless + JSON responses: every tool is a plain
//! request/response call, and it keeps working behind the app's compression
//! layer. The tools call back into this server's own REST API on loopback.

use std::sync::Arc;

use axum::Router;
use deployment::Deployment;
use mcp::task_server::McpServer;
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};

use crate::DeploymentImpl;

pub(super) fn router(deployment: &DeploymentImpl) -> Router {
    let deployment = deployment.clone();
    let service = StreamableHttpService::new(
        move || {
            let port = deployment
                .client_info()
                .get_server_addr()
                .map(|addr| addr.port())
                .ok_or_else(|| std::io::Error::other("server address not known yet"))?;
            // Headed local control: the captain drives headed sessions, so it
            // gets their tmux/session identifiers.
            Ok(
                McpServer::new_global(&format!("http://127.0.0.1:{port}"), true)
                    .without_context_tool(),
            )
        },
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default()
            .with_stateful_mode(false)
            .with_json_response(true),
    );
    Router::new().nest_service(services::services::captain::MCP_PATH, service)
}
