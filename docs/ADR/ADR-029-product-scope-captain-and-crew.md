# ADR-029: Product Scope — One Captain, a Crew of Agents

**Status**: Proposed (awaiting owner review)
**Date**: 2026-11-17

## Context

HiveDeck is three layers stacked on each other, not one product designed around a single idea:

1. **Upstream Vibe Kanban** — a team tool: Kanban board, issues, one git worktree per attempt ("workspace"), diff/PR, preview, many agent CLIs.
2. **The indie fork layer** — TUI, Telegram bridge, PM agent, an orchestrator running `/loop`, file-based pipelines, SpecKit, recurrent routines, headed (tmux) sessions. Each solved one need; none was folded into a shared model.
3. **The HiveDeck layer** — embedded 9router, role combos, role-based routing (ADR-026…028).

The owner's mental model is simpler: **a captain that coordinates a crew of agents**. Today that captain is only one mode among many, and day-to-day use surfaces the overlap: a question has to become an issue + workspace (+ branch + worktree), a remembered pipeline silently wraps a quick question in a four-stage workflow that auto-merges to `main`, Plan Mode and HiveDeck approvals collide, and so on.

Two findings make the gap concrete:

- **The captain does not live in this repo.** The orchestrator is launched as `claude --agent vibe-kanban-indie:orchestrator`; its behaviour is `agents/orchestrator.md` in the external `sombrax_plugins` plugin (ADR-016). That plugin is **not installed** on the owner's machine, so the captain cannot run at all. (The HiveDeck rename had also broken the plugin's agent ids; fixed in the same change as this ADR.)
- **Most of the surface area is not on the captain's path.** See the inventory below.

## Decision (proposed)

### 1. The core loop

Everything in the main UI serves this loop; anything else is Advanced or removed.

1. **Ask or assign.** You talk to the captain (or ask a quick question without creating anything).
2. **Plan.** The captain turns a goal into cards on the board and picks a role per card.
3. **Crew works.** Each card runs in its own worktree on the right agent, routed through 9router by role (planner / coder / reviewer / fast).
4. **Captain supervises.** It watches progress, answers or escalates blocked agents (approvals, Telegram), retries or reassigns.
5. **You decide.** You review the diff and merge. Nothing lands on `main` without you, unless you explicitly opted in.

### 2. Feature inventory

| Area | What it is | Proposal | Why / notes |
|---|---|---|---|
| Board (projects, issues, statuses) | The captain's work queue | **Core** | Keep simple: one board per project; sub-boards stay but are not pushed |
| Workspaces (worktree, chat, diff, merge, PR) | Where a crew member works | **Core** | One card → open its latest workspace directly; many attempts per card stay possible |
| Orchestrator / captain | Headed Claude session on `/loop`, board-scoped prompts (ADR-016) | **Core — must be fixed first** | Ship the captain's instructions inside HiveDeck instead of depending on an uninstalled external plugin (see Open questions) |
| MCP server (`hivedeck-mcp`, card tools, ADR-023) | The captain's hands on the board | **Core** | |
| Approvals inbox | Answer tool-permission prompts / questions | **Core** | |
| 9router: Router page, combos, routing | Models per role | **Core** | |
| Telegram bridge + PM agent | Escalations to the phone | **Core (roadmap)** | Matches "control from mobile/Telegram"; today send-only |
| Agents: Claude Code, Codex | Crew | **Core** | Both routed through 9router |
| Agents: OpenCode (+ headed) | Crew | **Advanced** | Keep, not routed yet |
| Agents: Amp, Gemini, Qwen, Copilot, Droid, Cursor | Upstream executors | **Advanced — hide from pickers unless the CLI is installed** | Code stays; they clutter every executor picker |
| Pipelines | Prompt-injected multi-stage workflows | **Advanced** | Default is already None, no auto-merge (ADR change of 2026-11-17). Long term the captain's own playbook replaces per-card pipelines |
| Headed (tmux) sessions | Agent TUI in a terminal | **Advanced** | Needed for the captain itself; not a choice users should face per task |
| Recurrent routines ("Common tasks") | Cron-like agent runs | **Advanced** | Useful, off the main path |
| Spec intake ("Generate spec") | One-line brief → spec via a throwaway agent run | **Advanced, later fold into the captain** | Overlaps with step 2 of the loop |
| SpecKit workbench + pipeline | Spec-driven-development viewer and stages | **Remove from main UI** (keep files) | A whole parallel workflow; revisit only if the captain needs it |
| Preview browser / proxy, dev server | Preview a running app | **Advanced** | |
| Terminal panel | Shell in a workspace | **Advanced** | |
| Tags, priority, issue hierarchy | Card metadata | **Keep minimal** | Don't extend |
| Themes (8 skins), notification sounds | Personalisation | **Settings only** | |
| TUI (`hivedeck-tui`) | Terminal cockpit | **Keep (separate binary)** | Manual override when the web UI isn't at hand |
| `review` crate (`hivedeck-review`) | PR review CLI | **Remove** | Calls `api.vibekanban.com` (upstream cloud) — dead in a local-only fork |
| `apps/macos` | Native SwiftUI sketch | **Remove / archive** | Unfinished duplicate of the web UI |
| `hosts/$hostId` routes | Leftover of the multi-host relay | **Remove** | Local-only fork (ADR-004) |
| VS Code webview route | Page for the upstream VS Code extension | **Verify, then keep or remove** | Depends on whether the upstream extension still works against HiveDeck |
| Tauri desktop app, npx CLI | Packaging | **Keep, defer** | Release URLs already point at `trieuluan/hivedeck` |

### 3. New pieces the loop needs

- **Quick ask**: chat with an agent in an existing checkout (or empty dir), read-only, no branch/worktree; "Turn into a workspace" when it becomes real work. Builds on the existing no-worktree workspace kinds.
- **Talk to the captain** as the default entry point (instead of the board or the workspace-create screen).
- **Card → chat**: clicking a card opens its latest workspace; none → create and start; several → list.

### 4. How "Advanced" works

One `Config.advanced_features` switch (default off) hides Advanced items from navigation, pickers and dialogs; nothing is deleted, existing data keeps working. Removals happen only after this ADR is accepted, each as its own commit.

## Proposed order

1. **Make the captain work** (blocker): decide where its instructions live; until then the core loop has no captain.
2. Advanced switch + hide Advanced items.
3. Remove dead code (`review` crate, `apps/macos`, `hosts` routes) and the SpecKit UI.
4. Quick ask, Talk to the captain, Card → chat.
5. Leftovers from the rename: logo still reads "VIBE KANBAN INDIE"; onboarding terms/privacy links point at vibekanban.com.

## Open questions for the owner

1. **Captain**: install the external `vibe-kanban-indie` plugin from sombrax-plugins, or have HiveDeck ship its own captain (instructions and sub-agents as files in this repo, passed to Claude Code at launch)? *Recommendation: ship our own — the captain is the product.*
2. **Agents**: which CLIs do you actually use besides Claude Code and Codex?
3. **SpecKit**: drop from the UI, or do you use it?
4. **Desktop app**: needed soon, or web UI only for now?

## Consequences

- The main UI shrinks to the board, workspaces, the captain, the router and approvals; power features stay one switch away.
- Upstream merges get harder where we hide or remove upstream features; acceptable for a single-owner fork.
- Every later change can be checked against the core loop above.
