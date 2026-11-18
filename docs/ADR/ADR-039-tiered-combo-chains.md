# ADR-039: Tiered combo chains with a pay-as-you-go backup

- **Status**: Accepted
- **Date**: 2026-11-18

## Context

Combos suggested by HiveDeck (ADR-027) were four models spread across
providers, and providers that were out of quota were dropped from them. In
practice three subscriptions ran out together (Claude rate limit, Codex usage
limit, OpenCode Go weekly limit) and every combo failed, while the providers
that ran out never came back into the chains after their reset. A prepaid
DeepSeek balance reported "100% left" and was ranked first, so the most
expensive-per-call option would have been used before the subscriptions.

## Decision

- Each chain has three parts, in order:
  1. **primary** — healthy subscription and free providers, best first, each
     provider once before any twice (at most twice, five models, at most one
     free model);
  2. **standby** — the best model of each provider that is only out until a
     quota resets (HTTP 429 usage/rate limits), so the combo uses it again on
     its own; 9router skips it while it is locked;
  3. **backup** — pay-as-you-go providers (`deepseek`, `openrouter`, or any
     provider whose quota is a balance), last, so they are billed only when
     everything above is out.
- Provider health gains a `Limited` status (temporary) separate from `Error`
  (bad credentials, empty balance, paid-credit models). A billing kind
  (`subscription` / `pay_as_you_go` / `free`) and every quota window (5h,
  daily, weekly, monthly, balance) are reported, not only the tightest.
- Applying a combo still test-calls every model, but a model that fails only
  because its provider is out of quota is accepted (it is a standby) and is
  not put on cooldown.
- Per-session rotations (ADR-036) rotate only the non-backup part, at most
  four rotations, and keep the backups last in every rotation.
- Legacy aliases (`deepseek-reasoner`, `deepseek-chat`) are ranked down;
  "usage credits are required" is a permanent failure, not a rate limit.

## Consequences

- A role keeps working as long as any provider (or the prepaid balance) has
  quota, and exhausted subscriptions come back without re-applying combos.
- Chains are longer (up to ten models); a standby at the front of a rotation
  costs one fast failed call before 9router falls through.
