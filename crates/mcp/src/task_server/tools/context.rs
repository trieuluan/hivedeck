use rmcp::{ErrorData, model::CallToolResult, tool, tool_router};

use super::McpServer;

#[tool_router(router = context_tools_router, vis = "pub")]
impl McpServer {
    #[tool(
        description = "Return project, issue, workspace, and orchestrator-session metadata for the current MCP context."
    )]
    async fn get_context(&self) -> Result<CallToolResult, ErrorData> {
        // The global HTTP endpoint (the captain's) has no per-workspace
        // context; answer instead of panicking, which would leave the client
        // waiting for a reply that never comes.
        match self.context.as_ref() {
            Some(context) => McpServer::success(context),
            None => Err(ErrorData::invalid_request(
                "No workspace context: this is HiveDeck's global MCP endpoint. \
                 Use list_projects / list_issues / list_workspaces instead.",
                None,
            )),
        }
    }
}
