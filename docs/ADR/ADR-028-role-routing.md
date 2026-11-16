# ADR-028: Route Agent Runs Through 9router by Role

**Status**: Accepted
**Date**: 2026-11-16

## Context

ADR-026 embedded 9router and ADR-027 suggests a combo per role (`planner`, `coder`, `reviewer`, `fast`). The last step is making agent runs actually use them, without the user hand-editing `~/.claude/settings.json` per task.

Facts verified on the maintainer's machine (Claude Code 2.1.306, 9router 0.5.119):

- Claude Code honours `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` from the **process environment**. The same variables passed through `--settings '{"env":…}'` are ignored for auth; Claude falls back to its OAuth login (which had expired, so every request failed with 401).
- `--model <combo>` works: Claude logs `[claude-code:unrecognized_model]` and still passes the name through to the base URL.
- 9router accepts loopback requests on `/v1` without an API key.

## Decision

1. **Settings.** `Config.nine_router.route_agents` (default off) and `Config.nine_router.roles { planner, coder, reviewer, fast }` (combo names; empty = agent default). Turning routing on pre-fills each role with a combo of the same name if one exists.
2. **Role per run** (`LocalContainerService::route_through_9router`): `ReviewRequest` → reviewer; a workspace with `kind = orchestrator` → planner; everything else → coder. Applies to Claude Code, Claude Code (headed) and Codex.
3. **What changes for a routed run** (`nine_router::routing::claude_route`):
   - Environment: `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/v1`, `ANTHROPIC_AUTH_TOKEN=hivedeck-local` (a placeholder, so the user's own Anthropic credentials are never sent to the router), and Claude's model aliases mapped onto combos: `ANTHROPIC_DEFAULT_OPUS_MODEL`/`…_FABLE_MODEL` → planner, `…_SONNET_MODEL` → coder, `…_HAIKU_MODEL`/`ANTHROPIC_SMALL_FAST_MODEL` → fast.
   - Model: the action's `ExecutorConfig.model_id` is set to the role's combo, **unless** the user already chose a model for the run or the profile sets one (`claude::has_explicit_model`; the "Default" sentinel does not count).
4. **Safety.** If 9router does not answer on its port, the run proceeds unrouted (logged), so a stopped router never blocks agents. Profile env still applies on top, so a profile that sets its own `ANTHROPIC_BASE_URL` wins.
5. **UI.** Router page → **Routing** tab: on/off, a combo per role (from `/v1/models`, works without the ADR-027 management consent), and a warning when a chosen combo no longer exists or the router is down.

## Consequences

- Verified end to end: a HiveDeck workspace run on Claude Code reached 9router as `coder` and 9router fell back across providers inside the combo (Claude → Antigravity → Codex) until the run completed.
- **Codex** is routed too: the executor turns `HIVEDECK_CODEX_ROUTER_BASE_URL` into root-level `-c` overrides (`model_provider="hivedeck_9router"` plus a `model_providers.hivedeck_9router` entry with the router's `/v1` base URL and `wire_api = "responses"`) placed before `app-server`. The app server's account check then runs against that provider, so no ChatGPT login or API key is needed, and `~/.codex/config.toml` is never touched. Verified with `@openai/codex@0.152.1`: a HiveDeck Codex workspace reached 9router as `coder`; the first model hit 429 and 9router fell back to the next one in the combo. Caveat: Codex sends ~100k input tokens per turn through the router with little prompt caching, far more than over a direct ChatGPT login.
- Other executors (OpenCode, Gemini, …) are not routed yet.
- Variables set in `~/.claude/settings.json` `env` may still override the process environment for the same key; routing only sets keys that are normally absent there, and the main model is passed as `--model`.
- Follow-ups inherit the role of their workspace; a code-review follow-up in a coding workspace stays on `coder`.
