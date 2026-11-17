# ADR-036: Per-session combo rotation

- **Status:** Accepted
- **Date:** 2026-11-18

## Context

Agents run through 9router combos (ADR-028). With 9router's round-robin (sticky 1) every request of a running session went to the next provider, so prompt caches never hit and a long card re-paid its whole context on every tool call. Measured through the local router (same ~17k-token prompt sent twice): with a stable provider the second request read ~88% from cache (GLM on both the Anthropic and OpenAI endpoints, Kimi on the OpenAI endpoint, Claude via `cc/` on the Anthropic endpoint); `cx/` models reported no cache. Switching to `fallback` fixed caching but put all load on the first model, while the owner wants every provider's quota (each with its own 5-hour window) used.

9router's round-robin counter is per combo, not per session, so it can't keep a session on one provider.

## Decision

HiveDeck rotates per session (`nine_router::rotation`):

- For the `coder` and `reviewer` role combos `[a, b, c, …]`, HiveDeck keeps rotations `coder-r1 = [a, b, c]`, `coder-r2 = [b, c, a]`, … in 9router, all walked as `fallback`.
- When routing a run, a session is pinned to rotation `session_id mod n`, so its follow-ups stay on one provider (warm cache) while new sessions start on different providers (quota spread). A provider that fails falls through to the next model.
- The captain (`planner`, one long session) and `fast` (Claude's background aliases) are not rotated.
- Setting: `nine_router.rotate_per_session` ("Rotate combos per session" on the Router page). Turning it on sets 9router's combo strategy to `fallback` and creates the rotations; turning it off removes them and restores round-robin. Rotations are re-synced when a combo is changed through HiveDeck, and lazily on the first routed run after a restart. They are hidden from HiveDeck's combo lists.

## Consequences

- Sessions keep their cache, and all providers in a combo get used over many sessions (spread is by session id, so it's even on average, not strictly alternating).
- A Claude Code session pinned to a model whose Anthropic-endpoint path doesn't cache (Kimi today) still pays full price; Codex is the better client for card work.
- A combo edited directly in 9router's dashboard keeps stale rotations until the next sync (toggle the setting or apply the combo from HiveDeck).
