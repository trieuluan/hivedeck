# ADR-040: Plain combos (no rotation) and cache-safe headless Claude runs

- **Status**: Accepted
- **Date**: 2026-11-18

## Context

Per-session rotation (ADR-036) kept `coder-r1..r4` / `reviewer-r1..r4`
copies of each combo so sessions started on different providers. The owner
prefers the four plain combos. Turning rotation off used to switch 9router
to request-level round-robin, which moves a session to another model on
every call and loses its prompt cache.

We measured caching through 9router (2026-11-18, two runs of a 3-step
read-files task per pair; Headroom off):

| CLI → model | 1st request | from 2nd request | next session reuses prefix |
|---|---|---|---|
| Claude Code → claude-sonnet/haiku-5-5 | ~9k written once | ~99% cached | yes (~23k) |
| Claude Code → deepseek-v4-pro / v4.1-flash | ~14k uncached | ~98–99% cached | no |
| Codex → claude-sonnet/haiku-5-5 | ~16k written | ~99% cached | yes (~16k) |
| Codex → deepseek-v4-pro / v4.1-flash | ~14k uncached | ~98–99% cached | yes |

Every model that answered caches well as long as a session stays on it, so
combo order is decided by cost and quality (ADR-039), not by cache. The
same test found that every Claude Code request to DeepSeek failed with 400:
DeepSeek rejects the JSON-schema `pattern` of Claude Code's claude.ai
`Artifact` tools.

Later the same day: OpenCode reached without a key (9router's public
account) answers HiveDeck's tiny test request but refuses every real agent
request from Claude Code or Codex with `FreeUsageLimitError` ("Free models
work in OpenCode"); `mmf/mimo-auto` failed with 502. With Codex back,
`cx/gpt-6-astra` cached ~99% from the 2nd request through Claude Code
(~12k input); through Codex the Codex backend reported ~108–112k input per
request, cached only from the 3rd request — outside HiveDeck's control.

## Decision

- Disabling session rotation deletes the rotation combos and keeps 9router
  on `fallback`; it never switches to round-robin. Rotation stays available
  as an opt-in.
- OpenCode models without a keyed connection (and any `-free` OpenCode
  model) are excluded from suggestions as "OpenCode app only", recorded in
  the blocklist; `FreeUsageLimitError` counts as a permanent failure. A
  model the owner restores is remembered and not hidden again.
- Headless Claude runs routed through 9router get `modelOverrides` in their
  `--settings` mapping a real Claude ID to each combo alias (`planner` ↔
  Opus 5.5, `coder` ↔ Sonnet 5.5, `fast` ↔ Haiku 5.5, the run's own combo
  ↔ a spare ID of its kind). Claude Code then treats the alias as that
  model (window, thinking, effort) and stops printing
  `[claude-code:unrecognized_model]`.
- Headless Claude runs always pass
  `--disallowedTools=Artifact,ArtifactComments,ArtifactData` (plus
  `AskUserQuestion` when not in plan/approval mode).

## Consequences

- With rotation off, every session starts at the top of its combo and only
  falls through when a model is out, so the first provider's quota is used
  first.
- DeepSeek works as the pay-as-you-go backup for Claude Code runs.
- Free `oc/*` models and limited providers (Codex, OpenCode Go) could not
  be measured that day; re-run the test when they are available.
