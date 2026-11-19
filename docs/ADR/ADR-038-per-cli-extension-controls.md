# ADR-038: Per-CLI control over skills, MCP and hooks in headless runs

- **Status**: Accepted
- **Date**: 2026-11-18

Superseded in part by ADR-043 and ADR-044.

## Context

Headless agent runs (card agents and the captain) load everything the owner
installed for their own interactive use: skills, MCP servers, hooks, plugins.
Each costs prompt tokens on every turn (skill and tool descriptions) or time
(hooks fire on every tool call). A blanket "economy mode" (`--bare`,
`--disable-slash-commands`, `--strict-mcp-config`, `--setting-sources`) would
cut that, but it would also drop things the owner installed on purpose, and
which items are worth keeping differs per CLI and per owner.

## Decision

- HiveDeck **lists** what each CLI has installed (`executors::extensions::inventory`)
  and the owner chooses, per CLI, what HiveDeck's headless runs load
  (Settings → Skills & MCP). Nothing is hardcoded, and the CLI's own config
  is never edited: choices live in `<asset_dir>/agent_extensions.json` and
  are applied as per-run flags.
- **Claude Code**: skills `on` / `name-only` / `off` via `--settings`
  `skillOverrides`; plugins via `enabledPlugins`; hooks via `disableAllHooks`;
  bundled skills via `disableBundledSkills`. Switched-off MCP servers: the run
  gets `--strict-mcp-config` with a `--mcp-config` holding the servers still
  on (user scope, the project's scope and `.mcp.json`, plus the captain's
  HiveDeck server). `--exclude-dynamic-system-prompt-sections` is on by
  default (no capability lost, better cache reuse); `--max-budget-usd` caps a
  single run when set.
- **Codex**: MCP servers switched off with `mcp_servers.<name>.enabled = false`
  in the thread config; HiveDeck's captain server can never be switched off.
  Skills and hooks are listed read-only for now.
- Moving a card into a cancelled column stops the agents still running on
  its workspaces (all issue-update HTTP paths, so the captain's MCP cancels
  too). Archiving alone only stopped dev servers.
- The captain's `nudge-stuck` rule now follows its 30-minute heartbeat instead
  of a 15-minute threshold it could not observe.
- Not done: resuming the old captain session on restart. After a long gap
  the prompt cache has expired, so resuming re-sends the whole history
  uncached; a fresh session reading the board is cheaper.

## Consequences

- Interactive sessions keep everything; only HiveDeck's background runs change.
- A run's own `--settings` from the profile's additional params may conflict
  with the one HiveDeck adds (the CLI decides how two `--settings` combine).
- Other CLIs show no entry until an inventory and its switches are written.
