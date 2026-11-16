# ADR-025: Rename the Fork to HiveDeck

**Status**: Accepted
**Date**: 2026-11-16

## Context

This repository was forked from `dendroman/vibe-kanban-indie` (itself a fork of `dexloom/vibe-kanban-indie` and upstream `BloopAI/vibe-kanban`) to become a separate open-source project, published as `trieuluan/hivedeck`. Its roadmap: multi-project management, 9router integration with per-role model combos, an IDE-like code/diff viewer, and control from mobile/Telegram.

Keeping the `vibe-kanban` name would collide with upstream on npm, in data directories, in binary names and in app identifiers, and would confuse users about which project they run.

## Decision

Rename the product to **HiveDeck** (display name) / **`hivedeck`** (identifiers):

| What | Before | After |
|---|---|---|
| Display name | Vibe Kanban / Vibe Kanban Indie | HiveDeck |
| npm package + CLI bin | `vibe-kanban-indie` / `vibe-kanban` | `hivedeck` |
| Binaries | `vibe-kanban-mcp`, `vibe-tui`, `vibe-telegram-bridge` | `hivedeck-mcp`, `hivedeck-tui`, `hivedeck-telegram-bridge` |
| Tauri crate | `vibe-kanban-tauri` | `hivedeck-tauri` |
| Tauri identifier | `ai.bloop.vibe-kanban` | `dev.hivedeck.app` |
| App data dir (`ProjectDirs`) | `ai/bloop/vibe-kanban` | `dev/hivedeck/hivedeck` |
| Home dir | `~/.vibe-kanban[-dev]` | `~/.hivedeck[-dev]` |
| Temp dir / port file | `$TMPDIR/vibe-kanban/vibe-kanban.port` | `$TMPDIR/hivedeck/hivedeck.port` |
| Env vars | `VIBE_KANBAN_*` | `HIVEDECK_*` |
| Agent commit identity | `Vibe Kanban <noreply@vibekanban.com>` | `HiveDeck <noreply@hivedeck.local>` |
| Repo / release URLs | `dexloom/vibe-kanban-indie` | `trieuluan/hivedeck` |

Deliberately **not** renamed:

- Links to real external resources: `vibekanban.com` docs/terms/privacy, `api.vibekanban.com` (review service), the VS Code extension id `bloop.vibe-kanban`, and credits to `BloopAI/vibe-kanban` / `dexloom` / `dendroman`.
- History: `CHANGELOG.md`, `CONTEXT.md`, earlier ADRs.
- Internal workspace packages `@vibe/*`, the `VK_*` env vars and the `.vibe-attachments` folder (internal, not user-facing branding).
- `apps/macos` (Swift target `VibeKanbanMac`): an Xcode target rename is a separate change.
- The SQL comment inside the SQLx-cached query in `crates/db/src/models/workspace.rs` (changing it would invalidate the `.sqlx` offline cache).

## Consequences

- Existing data under `~/.vibe-kanban` or `~/Library/Application Support/ai.bloop.vibe-kanban` is **not** migrated; no install of the old name existed on the maintainer's machine when this was done. Move it by hand if needed.
- MCP client configs that call `vibe-kanban-mcp` must be updated to `hivedeck-mcp`.
- Pulling from upstream will produce merge conflicts on renamed strings; resolve them toward the new names.
