use api_types::ListProjectsResponse;
use rmcp::{
    ErrorData, handler::server::wrapper::Parameters, model::CallToolResult, schemars, tool,
    tool_router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::McpServer;

#[derive(Debug, Default, Deserialize, schemars::JsonSchema)]
struct McpListProjectsRequest {
    #[schemars(
        description = "Optional organization ID. Ignored in local mode (a single implicit organization)."
    )]
    #[serde(default)]
    #[allow(dead_code)] // accepted for compatibility; local mode has one org
    organization_id: Option<Uuid>,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct ProjectSummary {
    #[schemars(description = "The unique identifier of the project")]
    id: String,
    #[schemars(description = "The name of the project")]
    name: String,
    #[schemars(description = "When the project was created")]
    created_at: String,
    #[schemars(description = "When the project was last updated")]
    updated_at: String,
    #[schemars(
        description = "IDs of the repositories linked to this project, in link order. Use the first one when starting a workspace for one of its cards."
    )]
    repo_ids: Vec<String>,
}

impl ProjectSummary {
    fn from_project(project: api_types::Project) -> Self {
        Self {
            id: project.id.to_string(),
            name: project.name,
            created_at: project.created_at.to_rfc3339(),
            updated_at: project.updated_at.to_rfc3339(),
            repo_ids: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpListProjectsResponse {
    projects: Vec<ProjectSummary>,
    count: usize,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpListProjectStatusesRequest {
    #[schemars(
        description = "The ID of the project whose statuses to list. Optional if running inside a workspace linked to a project."
    )]
    project_id: Option<Uuid>,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct ProjectStatusSummary {
    #[schemars(description = "The status ID (UUID)")]
    id: String,
    #[schemars(description = "The status name")]
    name: String,
    #[schemars(description = "The status color")]
    color: String,
    #[schemars(description = "The status sort order")]
    sort_order: i32,
    #[schemars(description = "Whether the status is hidden")]
    hidden: bool,
    #[schemars(description = "Whether the status is terminal (finished)")]
    is_terminal: bool,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpListProjectStatusesResponse {
    project_id: String,
    statuses: Vec<ProjectStatusSummary>,
    count: usize,
}

impl McpServer {
    /// Repo IDs linked to a project (`GET /v1/projects/{id}/repos`, a plain
    /// `{ "repos": [...] }` body). Best effort: an error yields an empty list.
    async fn project_repo_ids(&self, project_id: &str) -> Vec<String> {
        let url = self.url(&format!("/v1/projects/{project_id}/repos"));
        let Ok(resp) = self.client.get(&url).send().await else {
            return Vec::new();
        };
        let Ok(body) = resp.json::<serde_json::Value>().await else {
            return Vec::new();
        };
        body.get("repos")
            .and_then(|r| r.as_array())
            .map(|repos| {
                repos
                    .iter()
                    .filter_map(|r| r.get("id").and_then(|id| id.as_str()).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[tool_router(router = projects_tools_router, vis = "pub")]
impl McpServer {
    #[tool(description = "List all the available projects")]
    async fn list_projects(
        &self,
        Parameters(McpListProjectsRequest { organization_id: _ }): Parameters<
            McpListProjectsRequest,
        >,
    ) -> Result<CallToolResult, ErrorData> {
        let url = self.url("/api/projects");
        let response: ListProjectsResponse = match self.send_json(self.client.get(&url)).await {
            Ok(r) => r,
            Err(e) => return Ok(Self::tool_error(e)),
        };

        let mut project_summaries: Vec<ProjectSummary> = response
            .projects
            .into_iter()
            .map(ProjectSummary::from_project)
            .collect();
        for summary in &mut project_summaries {
            summary.repo_ids = self.project_repo_ids(&summary.id).await;
        }

        McpServer::success(&McpListProjectsResponse {
            count: project_summaries.len(),
            projects: project_summaries,
        })
    }

    #[tool(description = "List all the statuses (kanban columns) for a project.")]
    async fn list_project_statuses(
        &self,
        Parameters(McpListProjectStatusesRequest { project_id }): Parameters<
            McpListProjectStatusesRequest,
        >,
    ) -> Result<CallToolResult, ErrorData> {
        let project_id = match self.resolve_project_id(project_id) {
            Ok(id) => id,
            Err(e) => return Ok(McpServer::tool_error(e)),
        };

        let project_statuses = match self.fetch_project_statuses(project_id).await {
            Ok(statuses) => statuses,
            Err(e) => return Ok(McpServer::tool_error(e)),
        };

        let statuses = project_statuses
            .into_iter()
            .map(|status| ProjectStatusSummary {
                id: status.id.to_string(),
                name: status.name,
                color: status.color,
                sort_order: status.sort_order,
                hidden: status.hidden,
                is_terminal: status.is_terminal,
            })
            .collect::<Vec<_>>();
        let count = statuses.len();

        McpServer::success(&McpListProjectStatusesResponse {
            project_id: project_id.to_string(),
            statuses,
            count,
        })
    }
}
