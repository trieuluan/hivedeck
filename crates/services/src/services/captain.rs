//! The HiveDeck captain (ADR-030): the orchestrator's instructions, shipped in
//! this repo instead of an external Claude Code plugin.
//!
//! The captain runs as a headed Claude Code session. At launch HiveDeck passes
//! the agent inline (`--agents <json> --agent hivedeck-captain`) and points it
//! at the backend's own MCP endpoint (`--mcp-config`, streamable HTTP at
//! `/mcp`), so nothing has to be installed besides Claude Code.
//!
//! The instructions are `assets/captain/captain.md`; the owner can override
//! them with `<hivedeck home>/captain.md`.

use std::path::PathBuf;

use serde_json::json;

/// Agent id used for `--agent` and as the key in `--agents`.
pub const AGENT_ID: &str = "hivedeck-captain";
/// Name of the MCP server in the captain's `--mcp-config`.
pub const MCP_SERVER_NAME: &str = "hivedeck";
/// Path of the backend's MCP endpoint (streamable HTTP).
pub const MCP_PATH: &str = "/mcp";

const DESCRIPTION: &str = "HiveDeck captain: turns the owner's goals into cards, dispatches them \
     to a crew of coding agents, watches and unblocks them, and hands finished work back for \
     review. Acts only through the hivedeck MCP tools.";
const BUNDLED_PROMPT: &str = include_str!("../../../../assets/captain/captain.md");

/// Owner override: `<hivedeck home>/captain.md`.
pub fn override_path() -> PathBuf {
    utils::path::get_hivedeck_home_dir().join("captain.md")
}

/// The captain's instructions: the owner's override if present and non-empty,
/// otherwise the bundled file.
pub fn prompt() -> String {
    std::fs::read_to_string(override_path())
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| BUNDLED_PROMPT.to_string())
}

/// JSON for Claude Code's `--agents` flag defining the captain.
pub fn agents_json() -> String {
    json!({
        AGENT_ID: {
            "description": DESCRIPTION,
            "prompt": prompt(),
        }
    })
    .to_string()
}

/// JSON for Claude Code's `--mcp-config` flag: the backend's MCP endpoint.
pub fn mcp_config_json(backend_port: u16) -> String {
    json!({
        "mcpServers": {
            MCP_SERVER_NAME: {
                "type": "http",
                "url": format!("http://127.0.0.1:{backend_port}{MCP_PATH}"),
            }
        }
    })
    .to_string()
}

/// Whether a Claude agent id refers to the captain.
pub fn is_captain(agent_id: Option<&str>) -> bool {
    agent_id == Some(AGENT_ID)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agents_json_defines_the_captain() {
        let v: serde_json::Value = serde_json::from_str(&agents_json()).unwrap();
        let captain = &v[AGENT_ID];
        assert!(captain["description"].as_str().unwrap().contains("captain"));
        assert!(
            captain["prompt"]
                .as_str()
                .unwrap()
                .contains("# HiveDeck Captain")
        );
    }

    #[test]
    fn mcp_config_points_at_backend() {
        let v: serde_json::Value = serde_json::from_str(&mcp_config_json(3002)).unwrap();
        assert_eq!(v["mcpServers"]["hivedeck"]["type"], "http");
        assert_eq!(
            v["mcpServers"]["hivedeck"]["url"],
            "http://127.0.0.1:3002/mcp"
        );
    }

    #[test]
    fn bundled_prompt_names_only_real_tools() {
        for tool in [
            "list_projects",
            "list_project_statuses",
            "list_issues",
            "get_issue",
            "create_issue",
            "update_issue",
            "update_issue_status",
            "approve_issue",
            "get_orchestrator_prompt",
            "start_workspace",
            "run_session_prompt",
            "get_execution",
            "list_pending_approvals",
            "respond_to_approval",
            "stop_execution",
        ] {
            assert!(BUNDLED_PROMPT.contains(tool), "{tool} missing");
        }
    }

    #[test]
    fn bundled_prompt_resolves_statuses_at_runtime_not_by_name() {
        assert!(BUNDLED_PROMPT.contains("list_project_statuses"));
        assert!(BUNDLED_PROMPT.contains("update_issue_status"));
        assert!(BUNDLED_PROMPT.contains("hidden"));
        assert!(BUNDLED_PROMPT.contains("is_terminal"));
        assert!(BUNDLED_PROMPT.contains("needs_attention"));

        for fixed_column in ["Todo", "In Progress", "In Review", "Done", "Cancelled"] {
            assert!(
                !BUNDLED_PROMPT.contains(fixed_column),
                "captain prompt must not hardcode the status name {fixed_column}"
            );
        }
    }

    #[test]
    fn bundled_prompt_makes_approval_the_only_close_signal() {
        assert!(BUNDLED_PROMPT.contains("approve_issue"));
        assert!(BUNDLED_PROMPT.contains("approval_scope"));
        assert!(BUNDLED_PROMPT.contains("approval_at"));
        assert!(BUNDLED_PROMPT.contains("Never merge, push, or open a pull request."));
        assert!(!BUNDLED_PROMPT.contains("merge_issue"));
        assert!(!BUNDLED_PROMPT.contains("push_issue"));
    }
}
