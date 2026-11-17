# ADR-035: Event-driven captain wakeups

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

The backend captain loop (ADR-031) sent the captain a tick every 5 minutes. Each tick is a full model turn over the captain's session, and most of them found nothing to do. Skipping ticks while the board was idle (an earlier fix) helped, but while any card sat in Todo or In Progress the captain still woke every 5 minutes, even when nothing had moved.

## Decision

`crates/server/src/captain_loop.rs` wakes the captain on change instead of on a timer. Every 15 s it fingerprints what the captain watches, in its project:

- the cards (id, status, `updated_at`),
- the coding-agent runs on workspaces linked to those cards (id, status, `completed_at`),
- which of the running ones wait for an approval or an answer (`Approvals::get_pending_execution_process_ids`).

A tick is sent when the fingerprint differs from the one at the last tick, at least 20 s after the previous captain turn ended (so a burst of changes, and the captain's own moves, produce one wakeup). While cards are in Todo or In Progress a 30-minute heartbeat also wakes it. The fingerprint is taken when the loop starts, so the spawn prompt counts as the first tick. A `/loop <interval>` prefix is no longer used as the tick interval; status reports the heartbeat.

## Consequences

- An idle or unchanged board costs no model calls; a busy board costs one turn per change burst.
- A captain turn that itself moves cards produces one follow-up tick (it sees its own change); that tick usually ends quickly and the loop settles.
- An agent that runs silently is only checked on the heartbeat (30 min), not every 15 min as the prompt's "silent agent" rule suggests.
