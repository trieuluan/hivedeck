# ADR-033: The Claude Captain Runs Headless

**Status**: Accepted
**Date**: 2026-11-17
**Relates to**: ADR-030 (in-repo captain), ADR-031 (backend-driven loop), ADR-032 (project cockpit)

## Context

The Claude captain ran as headed Claude Code: a TUI in a tmux session, plus (by default) a terminal window attached to it. It needed the TUI only for Claude Code's `/loop`. Since ADR-031 the backend can drive the loop itself, and the project cockpit (ADR-032) already shows the captain's conversation beside the board, so the terminal adds a window, a tmux session and the "trust this folder" prompt without adding anything the owner needs.

ADR-032 also found that a Codex captain can't call HiveDeck's tools through non-OpenAI models. Claude Code uses plain Anthropic tool calls, which 9router translates for any model.

## Decision

- The dialog's **Claude Code** option now starts **headless Claude Code** (`CLAUDE_CODE`) with the backend loop, like Codex. Headed Claude (`CLAUDE_CODE_HEADED`) remains accepted by the API for existing setups.
- The container hands a headless Claude captain its definition and the MCP endpoint through env vars (`HIVEDECK_CLAUDE_CAPTAIN_AGENTS`, `HIVEDECK_CLAUDE_CAPTAIN_MCP_CONFIG`); the executor turns them into `--agents`, `--mcp-config=…` and `--allowedTools=mcp__hivedeck,Read,Glob,Grep` (HiveDeck tools plus read-only file tools, so it can see attached screenshots and the project code; edits and shell stay refused), and strips them from the child's environment. The ExecutorConfig carries `--agent hivedeck-captain`.
- **Permissions:** in `-p` mode only HiveDeck's MCP tools are pre-approved; edits and shell commands that need permission are refused. A profile-level `--dangerously-skip-permissions` is dropped for captain runs so it can't override that.

## Verified

On a throwaway project with the `planner` combo on two OpenCode-Go models (the setup where Codex failed): the captain ran without tmux or a terminal, called `list_issues` / `list_workspaces` scoped to its project, and on an owner message created the requested card in Todo.

## Consequences

- No terminal window, tmux session or trust prompt for the captain; each tick is a run in the captain's conversation.
- The owner can no longer type into the TUI; messages go through the chat box and are handled on the next tick (or immediately, as a follow-up).
- The global captain spawned from the sidebar uses the same picker, so it becomes headless too when Claude Code is chosen.
