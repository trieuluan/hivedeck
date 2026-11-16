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
5. **Apply and undo.** `POST /api/router/combos {name, models}` creates the combo or replaces an existing one's models, after validating the name and that every model is currently listed. Nothing is written without a click. Each card shows the change as a diff against the current combo (new models tagged, removed models listed); replacing one that drops 3+ models asks for inline confirmation. Before every write HiveDeck stores what it replaced in `runtime/9router/combo-history.json`, and `POST /api/router/combos/undo {name}` restores it (or deletes a combo HiveDeck created). One level of undo per combo.

6. **Excluding failing models.** Three layers, cheapest first:
   - *Cooldown locks* (free): `GET /api/models/availability` lists models 9router locked after errors, per connection. A model is excluded when it is locked on every usable account of its provider. Model-level errors that 9router also stamps on the connection (`lastError` naming `[provider/model]`, "not supported", `model_not_found`, or a matching `__all` lock) do not mark the whole provider as failing.
   - *Hidden models* (`runtime/9router/model-blocklist.json`): failures that waiting will not fix (e.g. "not supported when using Codex with a ChatGPT account") are remembered and never suggested again, even after 9router's 30-minute lock expires, until the user clicks "Show again".
   - *Test* (costs a tiny request per model): each card can ping its chain via `POST /api/models/test`; saving a combo always tests first and refuses to write if any model fails. Permanent failures are hidden; transient ones ("Model is unavailable") are skipped for 30 minutes; a model that passes clears its cooldown.
   Excluded models and their reasons are listed on the Combos tab.

API: `GET /api/router/suggestions`, `POST /api/router/combos`, `POST /api/router/combos/undo`, `POST /api/router/models/verify`, `POST /api/router/models/unblock`.

## Consequences

- The tier/effort heuristics encode model-naming conventions and will need tuning as providers ship new names; they live in one file with tests built from a real catalog.
- The alias table must be regenerated when 9router adds providers (unknown aliases fall back to "provider id = alias", which only loses quota data).
- Usage lookups call each provider's quota API through 9router, so suggestions take a few seconds and are fetched on demand (Refresh), not polled.
- Depends on 9router's CLI-token scheme and `/api/*` shapes; parsing is tolerant (missing fields degrade to "unknown"), and a rejected token surfaces as an explicit error.
