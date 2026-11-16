# ADR-027: Role-Based Combo Suggestions via 9router's CLI Token

**Status**: Accepted
**Date**: 2026-11-16

## Context

ADR-026 embedded 9router. Before mapping HiveDeck agent roles to 9router combos (phase 2), users need good combos to map to. Building them by hand means knowing which connected providers are healthy, how much quota each has left, and which of 100+ model variants (`-high`, `-review`, `[1m]`, …) suits which job.

9router exposes what is needed, but only `/v1/models` (models + capabilities) is public. Provider connections (`/api/providers`), quota (`/api/usage/<connectionId>`) and combo writes (`/api/combos`) require auth: a dashboard JWT cookie, or the `x-9r-cli-token` header that 9router's own CLI uses. The CLI token is `sha256(machine-id + "9r-cli-auth" + cli-secret)[..16]`, from `~/.9router/machine-id` and `~/.9router/auth/cli-secret` (mode 0600).

## Decision

1. **Opt-in management.** `Config.nine_router.allow_management` (default `false`). The Combos tab shows a consent screen that states exactly which files are read and what is written. Only after consent does HiveDeck derive the CLI token (`nine_router::api`), per request, never storing or logging it, and only sending it to `127.0.0.1`. Revocable from the same tab.
2. **Data.** `/v1/models` (capabilities), `/api/providers` (connections; 9router strips secrets), `/api/usage/<id>` for each active connection in parallel, `/api/combos`. Model ids carry a provider *alias* (`cc/…`) while connections use provider ids (`claude`); the alias table is generated from 9router's provider registry into `nine_router/aliases.rs`.
3. **Provider health.** Per provider, the best of its connections (9router rotates between accounts): `ok`, `low` (< 20% of the tightest quota window), `exhausted` (< 2%), `error` (failed test / credential errors), `inactive`, `unknown` (no usage API). Only `ok`/`low`/`unknown` providers are used.
4. **Scoring** (`nine_router::advisor`, pure and unit-tested). Model names are tokenized (so `gemini` is not `mini`), variant markers parsed (effort `none…xhigh`, `-thinking`, `-review`, `[1m]`), a tier inferred (frontier / strong / fast / unknown), and recency computed within a model line (`claude-opus-5-5` beats `claude-opus-4-6`). Four roles:
   - `planner`: strength, reasoning, context; high-effort variants; generalists over coding specialists.
   - `coder`: coding affinity and quota weigh most; strong mid-tier preferred over the slowest frontier models.
   - `reviewer`: strength and reasoning; `-review` variants; penalized when from the coder's top model family.
   - `fast`: speed, quota, recency; low-effort variants.
   Each role gets a chain of up to 4 models, first spread across distinct providers (max 2 per provider, one variant per model) so one exhausted provider never takes a role down.
5. **Apply.** `POST /api/router/combos {name, models}` creates the combo or replaces an existing one's models, after validating the name and that every model is currently listed. Nothing is written without a click; existing combos are shown next to the suggestion with an "Up to date" state.

API: `GET /api/router/suggestions`, `POST /api/router/combos`.

## Consequences

- The tier/effort heuristics encode model-naming conventions and will need tuning as providers ship new names; they live in one file with tests built from a real catalog.
- The alias table must be regenerated when 9router adds providers (unknown aliases fall back to "provider id = alias", which only loses quota data).
- Usage lookups call each provider's quota API through 9router, so suggestions take a few seconds and are fetched on demand (Refresh), not polled.
- Depends on 9router's CLI-token scheme and `/api/*` shapes; parsing is tolerant (missing fields degrade to "unknown"), and a rejected token surfaces as an explicit error.
