# ADR-030: The Captain Lives in HiveDeck

**Status**: Accepted
**Date**: 2026-11-17
**Relates to**: ADR-016 (board orchestrator prompts), ADR-028 (role routing), ADR-029 (product scope)

## Context

The orchestrator ("captain") was launched as `claude --agent vibe-kanban-indie:orchestrator`: its behaviour was `agents/orchestrator.md` in the external `sombrax_plugins` Claude Code plugin, and its MCP tools came from that plugin's `.mcp.json` (`npx vibe-kanban-indie@latest --mcp`, the upstream npm package, not HiveDeck). The plugin was not installed on the owner's machine, so the captain could not start at all. The plugin repo is public but unlicensed, so it cannot be vendored. ADR-029 names the captain the core of the product; it must not depend on someone else's plugin.

Verified with Claude Code 2.1.306–2.1.325:

- `--agents '<json>'` defines agents inline; `--agent <id>` runs the session as one of them.
- `--mcp-config` accepts a JSON string; a `{"type":"http","url":…}` server works. The flag is variadic, so it must be passed as `--mcp-config=<json>` before the positional prompt.
- In a fresh folder the headed session first shows the folder-trust prompt, now defaulting to **"No, exit"**: HiveDeck's auto-confirm pressed Enter and every fresh headed session exited immediately (exit 0, no transcript).

## Decision

1. **Instructions in the repo.** `assets/captain/captain.md` is the captain's operating manual, written for HiveDeck's actual MCP tools: owner first → watch active cards → dispatch `Todo` (max 3 in progress) → plan new goals → short report. Finished work goes to `In Review`; the captain never merges or moves cards to `Done`. It defines the four spawn-dialog directives (`auto-unblock`, `auto-answer-questions`, `telegram-fanout`, `nudge-stuck`). The owner can override it with `<hivedeck home>/captain.md`.
2. **MCP over HTTP from the backend.** `rmcp`'s streamable-HTTP transport serves the global-mode `McpServer` at `/mcp` (stateless, JSON responses, origin-checked like the other routes). The tools call back into the backend on loopback. No `hivedeck-mcp` binary or npx download is needed. `list_projects` now also returns each project's `repo_ids` so the captain knows where to start workspaces.
3. **Launch.** The orchestrator's executor config uses agent id `hivedeck-captain` (`services::captain::AGENT_ID`). When the headed container path sees that id it adds `--agents {"hivedeck-captain": {description, prompt}}` and `--mcp-config={"mcpServers":{"hivedeck":{"type":"http","url":"http://127.0.0.1:<port>/mcp"}}}`. With routing on (ADR-028) the run is a planner-role run through 9router.
4. **Trust prompt fix.** Auto-confirm now reads which option is highlighted: on "No, exit" it sends `Down` first and presses Enter only once "Yes" is highlighted (no highlight marker → old behaviour). This fixes fresh headed sessions in general, not only the captain.
5. The `/loop` pointer composed by the spawn dialog now refers to the captain's instructions instead of the plugin's two-mode tick.

## Consequences

- Verified end to end: spawning the orchestrator started `@hivedeck-captain` on the `planner` combo, it called the hivedeck MCP tools and reported correctly (and flagged that the `hivedeck` project has no linked repo, so its `Todo` card cannot be dispatched).
- The captain's behaviour is now ours to evolve; the external plugin's richer features (intake/decider/product sub-agents, adaptive cadence, knowledge skills) are not carried over and can be added to `captain.md` or as extra inline agents when needed.
- The plugin's `vibe-kanban-indie:*` sub-agent ids are still referenced by the Async pipelines; those pipelines keep requiring that plugin (they are Advanced per ADR-029).
- `/mcp` is a new loopback endpoint; any local MCP client can use it.
