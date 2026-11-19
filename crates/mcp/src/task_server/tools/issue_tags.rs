use api_types::{
    CreateIssueTagRequest, CreateTagRequest, IssueTag, ListIssueTagsResponse, ListTagsResponse,
    MutationResponse, Tag,
};
use rmcp::{
    ErrorData, handler::server::wrapper::Parameters, model::CallToolResult, schemars, tool,
    tool_router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{McpServer, ToolError};

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpListTagsRequest {
    #[schemars(
        description = "The project ID to list tags from. Optional if running inside a workspace linked to a remote project."
    )]
    project_id: Option<Uuid>,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct TagSummary {
    #[schemars(description = "Tag ID")]
    id: String,
    #[schemars(description = "Project ID")]
    project_id: String,
    #[schemars(description = "Tag name")]
    name: String,
    #[schemars(description = "Tag color value")]
    color: String,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpListTagsResponse {
    project_id: String,
    tags: Vec<TagSummary>,
    count: usize,
}

/// The kanban UI sets no limit on tag names; this bounds MCP input only.
const MAX_TAG_NAME_CHARS: usize = 50;
/// First entry of the UI's `PRESET_COLORS` (`packages/ui/.../ColorPicker.tsx`),
/// which the UI picks for a new tag by default. HSL triplet, not hex.
const DEFAULT_TAG_COLOR: &str = "0 84% 60%";

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpCreateTagRequest {
    #[schemars(
        description = "The project ID to create the tag in. Optional if running inside a workspace linked to a remote project."
    )]
    project_id: Option<Uuid>,
    #[schemars(description = "Tag name (trimmed, 1-50 characters)")]
    name: String,
    #[schemars(
        description = "Tag color as an HSL triplet like '0 84% 60%' (the UI format). Defaults to the UI's default color."
    )]
    color: Option<String>,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpCreateTagResponse {
    tag_id: String,
    name: String,
    color: String,
    #[schemars(description = "false if a tag with that name already existed and was returned")]
    created: bool,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpListIssueTagsRequest {
    #[schemars(description = "Issue ID to list tags for")]
    issue_id: Uuid,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct IssueTagSummary {
    #[schemars(description = "Issue-tag relation ID")]
    id: String,
    #[schemars(description = "Issue ID")]
    issue_id: String,
    #[schemars(description = "Tag ID")]
    tag_id: String,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpListIssueTagsResponse {
    issue_id: String,
    issue_tags: Vec<IssueTagSummary>,
    count: usize,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpAddIssueTagRequest {
    #[schemars(description = "Issue ID to attach the tag to")]
    issue_id: Uuid,
    #[schemars(description = "Tag ID to attach")]
    tag_id: Uuid,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpAddIssueTagResponse {
    issue_tag_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct McpRemoveIssueTagRequest {
    #[schemars(description = "Issue-tag relation ID to remove")]
    issue_tag_id: Uuid,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
struct McpRemoveIssueTagResponse {
    success: bool,
    issue_tag_id: String,
}

impl McpServer {
    pub(super) async fn fetch_project_tags(&self, project_id: Uuid) -> Result<Vec<Tag>, ToolError> {
        let url = self.url(&format!("/api/project-tags?project_id={}", project_id));
        let response: ListTagsResponse = self.send_json(self.client.get(&url)).await?;
        Ok(response.tags)
    }

    pub(super) async fn attach_issue_tag(
        &self,
        issue_id: Uuid,
        tag_id: Uuid,
    ) -> Result<IssueTag, ToolError> {
        let payload = CreateIssueTagRequest {
            id: None,
            issue_id,
            tag_id,
        };
        let url = self.url("/api/issue-tags");
        let response: MutationResponse<IssueTag> = self
            .send_json(self.client.post(&url).json(&payload))
            .await?;
        Ok(response.data)
    }
    fn tag_created_response(tag: Tag, created: bool) -> Result<CallToolResult, ErrorData> {
        McpServer::success(&McpCreateTagResponse {
            tag_id: tag.id.to_string(),
            name: tag.name,
            color: tag.color,
            created,
        })
    }
}

#[tool_router(router = issue_tags_tools_router, vis = "pub")]
impl McpServer {
    #[tool(
        description = "List tags for a project. `project_id` is optional if running inside a workspace linked to a remote project."
    )]
    async fn list_tags(
        &self,
        Parameters(McpListTagsRequest { project_id }): Parameters<McpListTagsRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let project_id = match self.resolve_project_id(project_id) {
            Ok(id) => id,
            Err(e) => return Ok(Self::tool_error(e)),
        };

        let response = match self.fetch_project_tags(project_id).await {
            Ok(r) => r,
            Err(e) => return Ok(Self::tool_error(e)),
        };

        let tags = response
            .into_iter()
            .map(|tag| TagSummary {
                id: tag.id.to_string(),
                project_id: tag.project_id.to_string(),
                name: tag.name,
                color: tag.color,
            })
            .collect::<Vec<_>>();

        McpServer::success(&McpListTagsResponse {
            project_id: project_id.to_string(),
            count: tags.len(),
            tags,
        })
    }

    #[tool(
        description = "Create a tag in a project. Idempotent: if a tag with the same name (case-insensitive) already exists in the project, that tag is returned with `created: false` instead of creating a duplicate. `name` is required (trimmed, max 50 chars); `color` is optional (HSL triplet like '0 84% 60%', defaults to the UI default). `project_id` is optional if running inside a workspace linked to a remote project."
    )]
    async fn create_tag(
        &self,
        Parameters(McpCreateTagRequest {
            project_id,
            name,
            color,
        }): Parameters<McpCreateTagRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Self::err("name must not be empty", None);
        }
        if name.chars().count() > MAX_TAG_NAME_CHARS {
            return Self::err(
                format!("name must be at most {MAX_TAG_NAME_CHARS} characters"),
                None,
            );
        }
        let color = match color.as_deref().map(str::trim) {
            None => DEFAULT_TAG_COLOR.to_string(),
            Some("") => return Self::err("color must not be empty when provided", None),
            Some(color) => color.to_string(),
        };
        let project_id = match self.resolve_project_id(project_id) {
            Ok(id) => id,
            Err(e) => return Ok(Self::tool_error(e)),
        };

        let list_url = self.url(&format!("/api/project-tags?project_id={}", project_id));
        let existing: ListTagsResponse = match self.send_json(self.client.get(&list_url)).await {
            Ok(r) => r,
            Err(e) => return Ok(Self::tool_error(e)),
        };
        let wanted = name.to_lowercase();
        if let Some(tag) = existing
            .tags
            .into_iter()
            .find(|tag| tag.name.trim().to_lowercase() == wanted)
        {
            return Self::tag_created_response(tag, false);
        }

        // Same route the UI uses (`insertTag` -> `POST /v1/tags`). It returns a
        // bare `MutationResponse`, not the `/api` envelope, so skip `send_json`.
        let payload = CreateTagRequest {
            id: None,
            project_id,
            name,
            color,
        };
        let url = self.url("/v1/tags");
        let resp = match self.client.post(&url).json(&payload).send().await {
            Ok(r) => r,
            Err(e) => {
                return Self::err(
                    "Failed to connect to VK API".to_string(),
                    Some(e.to_string()),
                );
            }
        };
        if !resp.status().is_success() {
            return Self::err(
                format!("VK API returned error status: {}", resp.status()),
                None,
            );
        }
        let created: MutationResponse<Tag> = match resp.json().await {
            Ok(r) => r,
            Err(e) => {
                return Self::err(
                    "Failed to parse VK API response".to_string(),
                    Some(e.to_string()),
                );
            }
        };
        Self::tag_created_response(created.data, true)
    }

    #[tool(description = "List tags attached to an issue.")]
    async fn list_issue_tags(
        &self,
        Parameters(McpListIssueTagsRequest { issue_id }): Parameters<McpListIssueTagsRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let url = self.url(&format!("/api/issue-tags?issue_id={}", issue_id));
        let response: ListIssueTagsResponse = match self.send_json(self.client.get(&url)).await {
            Ok(r) => r,
            Err(e) => return Ok(Self::tool_error(e)),
        };

        let issue_tags = response
            .issue_tags
            .into_iter()
            .map(|issue_tag| IssueTagSummary {
                id: issue_tag.id.to_string(),
                issue_id: issue_tag.issue_id.to_string(),
                tag_id: issue_tag.tag_id.to_string(),
            })
            .collect::<Vec<_>>();

        McpServer::success(&McpListIssueTagsResponse {
            issue_id: issue_id.to_string(),
            count: issue_tags.len(),
            issue_tags,
        })
    }

    #[tool(description = "Attach a tag to an issue.")]
    async fn add_issue_tag(
        &self,
        Parameters(McpAddIssueTagRequest { issue_id, tag_id }): Parameters<McpAddIssueTagRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let response = match self.attach_issue_tag(issue_id, tag_id).await {
            Ok(r) => r,
            Err(e) => return Ok(Self::tool_error(e)),
        };

        McpServer::success(&McpAddIssueTagResponse {
            issue_tag_id: response.id.to_string(),
        })
    }

    #[tool(description = "Remove a tag from an issue using issue_tag_id.")]
    async fn remove_issue_tag(
        &self,
        Parameters(McpRemoveIssueTagRequest { issue_tag_id }): Parameters<McpRemoveIssueTagRequest>,
    ) -> Result<CallToolResult, ErrorData> {
        let url = self.url(&format!("/api/issue-tags/{}", issue_tag_id));
        if let Err(e) = self.send_empty_json(self.client.delete(&url)).await {
            return Ok(Self::tool_error(e));
        }

        McpServer::success(&McpRemoveIssueTagResponse {
            success: true,
            issue_tag_id: issue_tag_id.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::{Json, Router, extract::State, routing::get, serve};
    use rmcp::handler::server::tool::ToolRouter;
    use tokio::net::TcpListener;

    use super::*;
    use crate::task_server::McpMode;

    type Tags = Arc<Mutex<Vec<serde_json::Value>>>;

    async fn stub_list(State(tags): State<Tags>) -> Json<serde_json::Value> {
        let tags = tags.lock().unwrap().clone();
        Json(serde_json::json!({ "success": true, "data": { "tags": tags }, "message": null }))
    }

    /// Mirrors `POST /v1/tags`: bare `MutationResponse`, no envelope.
    async fn stub_create(
        State(tags): State<Tags>,
        Json(body): Json<serde_json::Value>,
    ) -> Json<serde_json::Value> {
        let tag = serde_json::json!({
            "id": Uuid::new_v4(),
            "project_id": body["project_id"],
            "name": body["name"],
            "color": body["color"],
        });
        tags.lock().unwrap().push(tag.clone());
        Json(serde_json::json!({ "data": tag, "txid": 1 }))
    }

    async fn server() -> (McpServer, Tags) {
        let tags = Tags::default();
        let app = Router::new()
            .route("/api/project-tags", get(stub_list))
            .route("/v1/tags", axum::routing::post(stub_create))
            .with_state(tags.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { serve(listener, app).await.unwrap() });
        let server = McpServer {
            client: reqwest::Client::new(),
            base_url,
            tool_router: ToolRouter::default(),
            context: None,
            mode: McpMode::Global,
            headed_local_control: false,
        };
        (server, tags)
    }

    async fn create(server: &McpServer, name: &str) -> CallToolResult {
        let request: McpCreateTagRequest = serde_json::from_value(serde_json::json!({
            "project_id": Uuid::from_u128(1),
            "name": name,
        }))
        .unwrap();
        server.create_tag(Parameters(request)).await.unwrap()
    }

    fn json(result: &CallToolResult) -> serde_json::Value {
        let text = &result.content[0].as_text().unwrap().text;
        serde_json::from_str(text).unwrap()
    }

    #[tokio::test]
    async fn create_tag_is_idempotent_case_insensitively() {
        let (server, tags) = server().await;

        let first = create(&server, "  Research ").await;
        assert_ne!(first.is_error, Some(true), "{first:?}");
        let first = json(&first);
        assert_eq!(first["created"], true);
        assert_eq!(first["name"], "Research");
        assert_eq!(first["color"], DEFAULT_TAG_COLOR);

        let second = json(&create(&server, "rEsEaRcH").await);
        assert_eq!(second["created"], false);
        assert_eq!(second["tag_id"], first["tag_id"]);
        assert_eq!(tags.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn create_tag_rejects_bad_names() {
        let (server, tags) = server().await;
        for name in ["", "   ", &"x".repeat(MAX_TAG_NAME_CHARS + 1)] {
            let result = create(&server, name).await;
            assert_eq!(result.is_error, Some(true), "name {name:?} accepted");
        }
        assert!(tags.lock().unwrap().is_empty());
    }
}
