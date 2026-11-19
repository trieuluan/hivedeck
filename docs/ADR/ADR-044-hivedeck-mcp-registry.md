# ADR-044: HiveDeck-owned MCP registry, injected per run

- **Status**: Accepted
- **Date**: 2026-11-19

## Context

Today the owner has two places for MCP servers, and neither covers the
"set it up once" case:

- **Settings → MCP** (inherited from vibe-kanban, `McpSettingsSection.tsx`,
  `routes/config.rs` `/mcp-config`) writes servers into one CLI's own config
  file at a time, via the per-CLI adapters in `crates/executors/src/mcp_config.rs`.
  It edits the owner's interactive CLI setup, and each CLI must be done by hand.
- **Settings → Skills & MCP** (ADR-038) lists what Claude Code and Codex
  already have installed and switches items off for HiveDeck's headless runs
  only. It cannot add anything, and it never edits a CLI's config.

Setting up a server such as Higgsfield for every CLI means installing it into
each CLI. That also loads its 100+ tool schemas into every run of that CLI,
including cards that never need it (see `docs/research/single-lean-cli.md`:
tool schemas are most of each request's overhead).

HiveDeck already injects one MCP server per run without touching any CLI
config: the captain's `hivedeck` server. Claude Code gets `--mcp-config` /
`--strict-mcp-config` (`extensions.rs`), Codex gets
`-c mcp_servers.<name>.url=…` (`codex.rs`), and OpenCode accepts config
through `OPENCODE_CONFIG_CONTENT` (`opencode.rs`).

## Decision

- HiveDeck keeps its **own MCP registry** in its asset dir, next to
  `agent_extensions.json`. Each entry holds a name, transport (stdio or
  streamable HTTP), command/args or URL, headers/env, and a scope.
- **v1 scope**: by role (captain / crew) and by board. Every entry runs on every supported CLI. Per-card
  filtering is deferred.
- At spawn, HiveDeck adds the matching entries to that run only, in the CLI's
  format: Claude Code through the run's `--mcp-config`, Codex through
  `mcp_servers.*` overrides, OpenCode through `OPENCODE_CONFIG_CONTENT`. Other
  CLIs are added only after they get an inventory (ADR-038) and a tested
  injection path.
- **No CLI config file is written.** Interactive sessions outside HiveDeck are
  unchanged. Removing an entry takes effect on the next run.
- Secrets (API keys, bearer tokens) are stored by HiveDeck outside Git and
  passed to the CLI through **environment variables**, never on the command
  line (visible in `ps`) or in logs. Codex uses `bearer_token_env_var`;
  Claude Code and OpenCode use env expansion in their MCP config, after the
  exact syntax is verified per version.
- **Secret storage (v1)**: values live in a separate file with mode `0600` in
  the asset dir, next to `agent_extensions.json`. The file is outside Git and
  secret values never reach logs.
- An **import** action copies a server definition from a CLI's existing
  config (for example Claude Code's `~/.claude.json`) into the registry. It
  reads; it does not write back.
- **UI v1**: a "HiveDeck MCP" section is added to the existing MCP page, with
  scope checkboxes per entry. Merging the two Settings pages (MCP and Skills &
  MCP) is deferred.
- The "install into CLI" action is removed; HiveDeck never writes CLI config.
- A registry entry with the same name as a server the CLI already has
  overrides it for that run, and the UI shows the clash.

## Consequences

- One place to set up MCP servers for HiveDeck's runs, with role and board scope,
  so heavy servers cost tokens only where they are used.
- ADR-038's rule "never edit the CLI's own config" holds for the default path.
- **OAuth-only remote servers are not solved.** Each CLI stores its own OAuth
  tokens; whether a per-run server finds the token from an earlier
  interactive login is unverified for Claude Code and Codex. Until tested,
  such servers must be logged in per CLI, and the UI marks them as such.
  Servers that take an API key or header work fully.
- Claude Code plugins (marketplaces, hooks) are Claude-specific and are not
  part of the registry; only the MCP servers inside them can be imported.
- Skills are out of scope here; sharing `SKILL.md` folders across CLIs is a
  separate decision.
## Verification (2026-11-19)

Local fake servers only (`127.0.0.1`): a streamable-HTTP MCP server, a
self-approving OAuth 2.1 server (metadata discovery, dynamic client
registration, PKCE, token), and an LLM endpoint that records the request and
returns 400. No real model call or real credential; each CLI ran with an
isolated `HOME`. Versions: Claude Code 2.1.326, Codex 0.167.0-alpha.4.1,
OpenCode 1.19.6.

**Per-run injection with a header secret from the environment: pass on all three.**

| CLI | Injection | Secret syntax | Result |
|---|---|---|---|
| Claude Code | `--strict-mcp-config --mcp-config='{"mcpServers":{…}}'` | `"Authorization": "Bearer ${VAR}"` (expanded inside `--mcp-config`) | Connected, header correct, `tools/list` done; tool sent to the model as `mcp__probe__…` |
| Codex | `-c mcp_servers.<n>.url=…` | `-c mcp_servers.<n>.bearer_token_env_var="VAR"` | Connected, header correct, `tools/list` done; server listed as a deferred namespace (`mcp__probe`, reached through tool search) |
| OpenCode | `OPENCODE_CONFIG_CONTENT` → `mcp.<n>` (`type: remote`) | `"Authorization": "Bearer {env:VAR}"` | Connected, header correct, `tools/list` done; tool in the model request |

The secret never appeared in the request sent to the model. The command line
carried only the variable name.

**OAuth token reuse when the server is only injected per run:**

| CLI | Login | Later per-run run | Token key |
|---|---|---|---|
| Codex | `codex mcp login <n> --no-browser -c mcp_servers.<n>.url=… -c mcp_oauth_credentials_store="file"`: works with no `config.toml` entry; nothing written to `config.toml` | **Pass**: valid token sent | `<name>\|<hash of URL>` in `$CODEX_HOME/.credentials.json` (keyring by default) |
| OpenCode | `opencode mcp auth <n>` with the server in `OPENCODE_CONFIG_CONTENT` | **Pass**: valid token sent | server name, with `serverUrl`, in `~/.local/share/opencode/mcp-auth.json` |
| Claude Code | `claude mcp login <n> [--no-browser]` exists | **Not tested** | On macOS the token goes to the login Keychain, which `HOME` does not isolate; the test could have written to the item holding the owner's own Claude credentials, so it was not run |

Implications for the registry:

- Keep each server's **name and URL identical** to what the owner logged in
  with. Codex keys tokens by both; OpenCode by name, with URL recorded.
- The UI can offer "log in" per CLI by running the CLI's own login command
  (`codex mcp login`, `opencode mcp auth`) with the registry entry injected.
  The CLI stores and refreshes the token itself; HiveDeck never handles it.
- Claude Code OAuth stays an open question until the owner tests it with a
  real server (log in once with `claude mcp login`, then run a HiveDeck card
  with the same server injected per run).
