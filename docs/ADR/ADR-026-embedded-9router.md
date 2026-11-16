# ADR-026: Embedded 9router (Managed Sidecar + Embedded Dashboard)

**Status**: Accepted
**Date**: 2026-11-16

## Context

HiveDeck's roadmap includes routing each agent role (planner, coder, reviewer, …) to a different model "combo". [9router](https://github.com/decolua/9router) (MIT) is a local OpenAI/Anthropic-compatible AI router that already provides exactly this: providers, API keys, combos with fallback, usage tracking, and a full web dashboard. The maintainer already runs it at `127.0.0.1:20128` and exposes combos named `planner`, `coder` and `reviewer`.

The goal is for 9router to feel built-in: available after installing HiveDeck, startable from inside the app, and configurable (providers, combos, keys) without leaving HiveDeck.

9router is a Next.js standalone app (~78 MB, `app/server.js`) shipped on npm with a CLI (`cli.js`) that adds an interactive menu, tray icon, self-update and "kill previous instance" logic. Its data lives in `~/.9router`. `GET /v1/models` is unauthenticated and lists combos with `owned_by: "combo"`. The dashboard (`/dashboard`, behind `/login`) sends no `X-Frame-Options`/CSP, so it can be embedded in an iframe.

Options considered:

1. **Re-implement 9router's UI in HiveDeck** against its internal `/api/*` — rejected: undocumented, JWT-protected, and 9router ships releases very frequently; HiveDeck would break on every upstream change.
2. **Vendor 9router's source into this repo** — rejected: a second large Next.js codebase to maintain and merge.
3. **Manage 9router as a sidecar process and embed its dashboard** — chosen.

## Decision

1. **Service** `services::services::nine_router` owns 9router's lifecycle:
   - **Detect** an install: HiveDeck-managed (`<hivedeck home>/runtime/9router/node_modules/9router`) first, else a global `9router` on `PATH`.
   - **Install** a pinned version (`PINNED_VERSION`) with `npm install --prefix <runtime dir>`; HiveDeck already requires Node.
   - **Start** by running a small launcher (`launch-9router.cjs`, embedded in the binary) with Node. The launcher prepares 9router's SQLite runtime and `require`s the standalone server directly, so the CLI's tray/self-update/menu never run. It binds to `127.0.0.1` only.
   - The process runs **detached in its own process group** and is **not** stopped when HiveDeck exits: other tools (e.g. the user's Claude Code) use the same router. Its PID is stored in `runtime/9router/9router.pid`, and its output is appended to `runtime/9router/9router.log` (never a pipe, so it survives a HiveDeck restart).
   - **Attach, don't duplicate**: if something already answers `GET /v1/models` on the configured port, HiveDeck treats it as an *external* instance. It reads its status but never starts a second instance or stops one it did not start.
2. **Config**: `Config.nine_router { auto_start, port }` (serde default, no version bump — same approach as ADR-024). With `auto_start`, the server starts 9router at boot unless it is already running.
3. **API**: `GET /api/router/status`, `GET /api/router/logs`, `POST /api/router/{install,start,stop,restart}`.
4. **UI**: a full-width **Router** page (`/router`, opened from the sidebar bottom bar) with status, controls, auto-start toggle, logs, the combos discovered from `/v1/models`, and the 9router dashboard embedded in an iframe for all provider/combo/key management.

Phase 2 (separate change) maps HiveDeck roles to combos and injects `ANTHROPIC_BASE_URL`/model into executor processes.

## Consequences

- HiveDeck depends on internals of a specific 9router version (the standalone `app/` layout and `hooks/sqliteRuntime.js`). This is contained in the launcher and pinned by `PINNED_VERSION`; bumping the pin requires a quick smoke test.
- The iframe loads `http://localhost:<port>/dashboard`. `localhost:3001` and `localhost:<port>` are the same site, so 9router's login cookie works in the iframe. When HiveDeck is opened via a LAN IP, the loopback-only router is unreachable from that browser; the page shows a note instead.
- A HiveDeck-started 9router keeps running after HiveDeck quits; it is stopped from the Router page (or by killing the PID in the pid file).
