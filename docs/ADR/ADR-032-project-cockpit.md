# ADR-032: One Project, One Repo, One Captain

**Status**: Accepted
**Date**: 2026-11-17
**Relates to**: ADR-029 (product scope), ADR-030 (in-repo captain), ADR-031 (captain on Codex)

## Context

ADR-029 proposed a cockpit per project: the owner chats with a captain that runs that project's board, and merges finished cards. Until now there was one global captain for every project, which had to guess each card's repo, and its chat lived in a separate workspace page away from the board.

## Decision

1. **A project names its repo.** The create-project dialog has a repository picker ("Choose later" allowed). The repo is linked through the existing `project_repos` table, which the captain reads through `list_projects`.
2. **Each project can have its own captain.** A captain is still an orchestrator workspace; the new nullable column `workspaces.captain_project_id` ties it to a project (`NULL` keeps the global captain). Lookups use runtime-checked queries (`Workspace::find_captain`), so the offline sqlx cache is untouched.
   - `POST /api/workspaces/orchestrator` takes an optional `project_id`; `close` and `status` take `?project_id=`. Status also returns the captain's `workspace_id`.
   - A project's captain runs from its own folder, `~/.hivedeck/captains/<id>-<name>`.
   - The backend prefixes the tick prompt with a scope line: project name, id and repo paths, and "work only on this project". The manual (`captain.md`) explains the line; without it the captain is global.
   - Backend loops (ADR-031) are keyed by captain workspace, so several can run at once.
   - Deleting a project stops its captain (loop and running tick) and archives the workspace.
3. **The project page is the cockpit.** A collapsible captain column sits left of the board: status (agent, running or stopped), Start/Manage, a "no repo linked" warning with a Link button, and the captain's conversation and chat box (the same panel used for workspaces in the right sidebar). Phase 1's Merge button on In Review cards closes the loop.

## Known limit

A **Codex** captain calls HiveDeck's MCP tools through Codex's Responses-API *namespace* tools, which only OpenAI models (`cx/…` in 9router) handle; other models in the `planner` combo call the namespace by its bare name and get `unsupported call`. Custom providers can't turn namespaces off in Codex 0.152. The dialog says so when Codex is picked; Claude Code has no such limit.

## Consequences

- The global captain keeps working unchanged; project captains are opt-in from the project page.
- Several captains may run at once, each costing its own ticks.
- Still to do (ADR-029 phase 3): hide the global "Orchestrator" sidebar group and per-workspace trees behind an Advanced switch, and make the project page the default landing.
