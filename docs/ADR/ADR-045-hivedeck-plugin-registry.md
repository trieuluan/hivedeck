# ADR-045: HiveDeck plugin asset store and per-run MCP/skill injection

> Standalone MCP servers are installed as one-server plugins. Settings manages
> them under Plugins, and the legacy MCP registry is migrated at startup.

- **Status**: Accepted
- **Date**: 2026-11-20

## Context

ADR-044 introduced a HiveDeck-owned MCP registry injected per run across
Claude Code, Codex, and OpenCode without editing any CLI's own config files.
Plugins bundle MCP servers alongside `SKILL.md` skills (and potentially
CLI-specific extras such as hooks or agents) under a pinned source/version.

HiveDeck needs a single local-only plugin store that installs plugins into its
asset directory, keeps per-MCP secrets isolated, validates manifests and pins,
and injects each plugin's MCP servers and skills per run according to role
(`captain` / `crew`), board, and CLI capability.

## Decision

- **Asset store (`crates/executors/src/plugins.rs`)**:
  - `plugins.json` sits in the asset dir next to `agent_extensions.json` and
    records `name`, `version`, `source`, `commit`/`tag`, `asset_hash` (deterministic
    SHA-256 of copied files), `enabled`, `mcp[]`, `skills[]`, `unsupported[]`,
    and conflict `notes[]`.
  - Copied plugin files live under `<asset_dir>/plugins/<name>/` (`.git`
    stripped on install/upgrade). Original `source` paths/repos are never modified
    or deleted on uninstall.
  - `plugins_secrets.json` stores per-plugin, per-MCP secret values with POSIX
    mode `0600`. Both metadata and secret files are written atomically via temp
    file + rename.
- **Validation & unsupported parts**:
  - Install/upgrade validates manifest presence (`.claude-plugin/plugin.json`,
    `plugin.json`, or `.mcp.json` / `skills/*/SKILL.md`), secret placeholders
    (`${VAR}` or `{env:VAR}`), and `version` / `commit` / `tag` pins.
  - Unsupported plugin sections (`hooks`, `agents`, `commands`, `lspServers`,
    `outputStyles`, `userConfig`, `channels`) are recorded in `unsupported[]`
    and ignored at runtime rather than writing into CLI configs.
- **MCP vs. skill entries**:
  - Plugin `mcp[]` entries reuse ADR-044 registry semantics: `roles` + `boards`
    scope only, no CLI filter, running on every supported CLI (`claude_code`,
    `codex`, `opencode`). Existing `/api/mcp-registry/import*` endpoints remain
    unchanged.
  - Plugin `skills[]` entries keep separate `path`, `roles`, `boards`, and
    `clis` filters.
- **Server API (`crates/server/src/routes/plugins.rs`)**:
  - Exposes `GET /api/plugins`, `POST /api/plugins/install`,
    `GET/DELETE /api/plugins/{name}`, `POST /api/plugins/{name}/enable`,
    `POST /api/plugins/{name}/disable`, `POST /api/plugins/{name}/upgrade`,
    `PUT /api/plugins/{name}/skills/{skill}`, `PUT /api/plugins/{name}/mcp/{mcp}`,
    and `GET/PUT/DELETE /api/plugins/{name}/mcp/{mcp}/secrets/{secret}`.
- **Spawn-time injection (`crates/local-deployment/src/container.rs`)**:
  - **MCP**: `plugins::select_mcp_for_run` merges enabled plugin MCP entries
    with `mcp_registry.json`, expands `${CLAUDE_PLUGIN_ROOT}` /
    `${HIVEDECK_PLUGIN_ROOT}`, and passes secrets via
    `HIVEDECK_MCP_PLUGIN_<PLUGIN>_<MCP>_<REF>_TOKEN` env vars using ADR-044
    per-run config (`--mcp-config`, `-c mcp_servers.*`, `OPENCODE_CONFIG_CONTENT`).
    `mcp_registry::codex_args` emits bare `mcp_servers.<name>` keys (matching
    Codex `-c` key parsing) and forwards stdio `env` secret vars via `/bin/sh`
    + `env_vars` so secret values never appear on the command line.
  - **Skills**: `plugins::materialize_run_skills` copies matched `SKILL.md`
    directories into `<asset_dir>/run_skills/<exec_id>/` and passes the path to
    CLIs that support a per-run skill directory flag:
    - `claude_code`: `--add-dir=<dir>` (containing `.claude/skills/<name>/SKILL.md`).
    - `opencode`: `OPENCODE_CONFIG_CONTENT` `skills.paths`.
    - `codex` and other CLIs: no CLI skill path flag (documented in
      `docs/research/executor-capability-matrix.md`); repo worktrees and
      `~/.codex` are never modified.
  - `run_skills/<exec_id>` is removed on completion, stop, spawn error, or
    spawn timeout.
- **Conflict & rollback**:
  - Collisions on MCP server or skill names across `plugins.json` and
    `mcp_registry.json` trigger `409 Conflict` (`abort`, default) unless the
    owner selects `skip` (disables incoming entry, records note) or `overwrite`
    (disables prior entry / drops colliding registry entry, records note).
  - Install and upgrade stage into temporary directories and roll back cleanly
    if validation, pin checks, or conflict checks fail.
  - Uninstall removes `<asset_dir>/plugins/<name>`, the `plugins.json` entry,
    and all `plugins_secrets.json` entries for that plugin without touching
    `source`.

## Consequences

- Plugins install once into HiveDeck's asset dir and work across supported CLIs
  without mutating user CLI configurations or worktrees.
- Asset hashes remain unchanged across enable/disable, scope edits, and failed
  upgrades, changing only on successful upgrade.
- CLIs without a per-run skill flag (such as Codex v0.152.1) still receive plugin
  MCP servers while safely skipping CLI skill path injection.

## Verification (2026-11-20)

`crates/executors/tests/plugin_injection.rs` installed fixture
`crates/executors/tests/fixtures/sample-plugin` (stdio MCP server `fixture-tool`
with secret `FIXTURE_API_KEY` + `skills/fixture-skill/SKILL.md` + `hooks`),
verified `asset_hash` stability and uninstall cleanup, and probed local CLIs
against local loopback mock LLM endpoints with isolated `HOME`:

- **Claude Code 2.1.326**: `fixture-skill` appeared in `init.skills`;
  `fixture-tool` completed `initialize` and `tools/list` with `FIXTURE_TOKEN`
  verified inside the MCP process; `mcp__fixture-tool__fixture_ping` sent in
  model tools.
- **Codex 0.152.1**: `fixture-tool` completed `initialize` and `tools/list` with
  `FIXTURE_TOKEN` verified inside the MCP process; `mcp__fixture_tool` /
  `fixture_ping` appeared in `/responses` tools; no skill path flag passed.
- **OpenCode 1.19.6**: `opencode --pure debug skill` listed `fixture-skill`;
  `opencode --pure run` completed `initialize` and `tools/list` with
  `FIXTURE_TOKEN` verified inside the MCP process.

## UI (2026-11-20)

- Settings section **Tiện ích** (`settings/PluginsSettingsSection.tsx`, nav id
  `plugins`) lists installed plugins with enable/disable, details, upgrade and
  remove. The old "Xem server" import button is gone; the "Lấy từ config CLI có
  sẵn" link now lives in this section (`plugins/ImportFromCli.tsx`, reuses
  `/api/mcp-registry/import*`).
- Add dialog previews via new `POST /api/plugins/preview` (stages the source,
  parses the manifest, installs nothing) and marks each MCP/skill as
  compatible / needs secret or OAuth / unsupported. Install sends secrets in the
  POST body; they are never returned (`secret_status` carries only `has_value`).
- `GET /api/plugins/{name}/latest-tag` backs the Upgrade button for
  tag-pinned remote sources (`git ls-remote`).
- Types (`InstalledPlugin`, `PluginView`, requests) are generated from Rust.

## Gemini CLI and Qwen Code injection (2026-11-20)

Checked against the installed packages (Gemini CLI 0.29.3, Qwen Code 0.9.1), not guessed.

- **MCP**: each run writes `run_skills/<run_id>/settings.json` and points the
  CLI at it with `GEMINI_CLI_SYSTEM_SETTINGS_PATH` / `QWEN_CODE_SYSTEM_SETTINGS_PATH`.
  The system layer merges over the user's settings and `mcpServers` is
  shallow-merged, so the owner's servers stay and no global file is written.
  The file is removed with the run's skills.
- **Secrets**: both CLIs expand `$VAR`/`${VAR}` from the process env when they
  load settings, so the file holds placeholders only. Gemini does not forward
  env vars named like secrets to stdio servers it spawns, but `env` entries in
  the server definition are applied after that filter.
- **Transport**: Gemini `{url, type:"http"}`; Qwen `{httpUrl}` (its `url` is SSE).
  Qwen needs `"$version": 2` in the file to skip its in-place migration.
- **Skills**: neither CLI loads a per-run skill dir natively. Skills are copied
  to `run_skills/<run_id>/skills`, passed through `--include-directories`
  (read access), and a catalog (name, description, `SKILL.md` path) is
  prepended to the run's prompt.
- **Verification**: `plugin_injection.rs` runs both CLIs against a local mock
  model and the fixture MCP server; the `fixture_ping` tool and the
  `(authed)` marker (secret from env) reach the model request. Same test also
  re-ran Claude Code 2.1.x, Codex, and OpenCode with the current code.
  Not done: installing a plugin through the web UI and a real-model run.
