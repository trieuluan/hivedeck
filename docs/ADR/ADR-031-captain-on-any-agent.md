# ADR-031: The Captain Runs on Codex Too

**Status**: Accepted
**Date**: 2026-11-17
**Relates to**: ADR-028 (role routing), ADR-029 (product scope), ADR-030 (in-repo captain)

## Context

ADR-030 made the captain HiveDeck's own, but it only runs as **headed Claude Code**. It depends on four Claude Code features: `/loop` (one tick every few minutes), `--agents` / `--agent` (to load the captain's manual), `--mcp-config` (for HiveDeck's tools), and the trust-prompt handling of the headed launcher. The owner wants to pick the captain's agent, Codex in particular.

The model was never the constraint: with role routing on (ADR-028) the captain already runs on the `planner` combo, which can hold any model. The constraint is the CLI around it.

## Decision

**HiveDeck drives the loop itself** for agents that don't have one, starting with Codex:

1. **Spawn** (`POST /api/workspaces/orchestrator`) accepts `executor: CODEX` as well as the headed agents. The dialog has an agent picker (Claude Code / Codex, remembered per browser).
2. **Manual and tools.** For an orchestrator workspace running Codex, the container sets two env vars that the Codex executor turns into:
   - `developer_instructions` = the captain's manual (`captain::prompt()`, same file and override as the Claude captain);
   - a root-level `-c mcp_servers.hivedeck.url="http://127.0.0.1:<port>/mcp"` (Codex's streamable-HTTP MCP client against the endpoint added in ADR-030).
   Both are stripped from the child's environment. Codex runs with `permission_policy: Auto` (it only calls HiveDeck's MCP tools).
3. **Backend loop** (`crates/server/src/captain_loop.rs`). The prompt's `/loop <interval>` prefix is parsed (`30s`/`5m`/`2h`, minimum one minute, default 5 min). Codex gets only the body. Every 15 s the loop checks the captain's latest coding-agent run; once it has finished and the interval has passed, it sends the body as a follow-up on the same session (the shared `run_follow_up`). It stops when the workspace is deleted or archived, when a run is killed (owner pressed stop), or after three consecutive failures (failed ticks or ticks that couldn't start).
4. **Status** (`GET /api/workspaces/orchestrator/status`) reports whether the captain is on, on which agent, and the loop interval, because a Codex captain is idle between ticks yet still on. The dialog uses it. **Close** stops the loop first, then kills a running tick.

The headed Claude captain is unchanged: it keeps its own `/loop`.

### Fixed along the way

- **Follow-ups to the orchestrator always failed** ("Workspace has no repositories configured"): `ensure_container_exists` demanded repos for no-worktree kinds. It now only ensures their fixed folder, as `create` does. This also broke the owner's chat messages to the captain.
- **`get_context` hung every MCP client on `/mcp`**: the HTTP endpoint builds the server without `init`, so `get_context` stayed listed with no context and panicked (`expect`), leaving the call unanswered until the client timed out (300 s in Codex). The endpoint no longer lists it, and it returns an error instead of panicking.
- **Codex routing (ADR-028) was never merged to `main`**; it is merged here.

## Consequences

- The captain can be Claude Code (headed) or Codex. Each tick on Codex is a visible run in the captain's workspace, with its own transcript.
- The loop lives in memory: a backend restart stops it, and spawning again restarts it. Persisting it is a later step if it matters.
- Codex through 9router is not prompt-cached like a direct ChatGPT login; each tick re-sends the growing context (ADR-028 notes the same for coder runs).
- Other agents (OpenCode, Gemini CLI) can follow the same path: wire the manual and the MCP endpoint in their executor, and allow them in `is_captain_executor`. Antigravity is an IDE, not a CLI HiveDeck can run; its models are usable through 9router.
