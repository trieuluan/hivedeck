# ADR-041: Role tiers and distinct heads in combo suggestions

- **Status**: Accepted
- **Date**: 2026-11-19

## Context

Combo suggestions (ADR-039) ranked every role mostly by "strongest model with
quota", so planner, coder, reviewer and fast often started on the same model
or the same provider. That wastes quota twice: the coder's volume drains the
pool the planner needs, and frontier models burn plan quota on work a
mid-tier or fast model does as well. Gemini (paid API key) and OpenRouter
were added; OpenRouter's key only exposes rate-limited `:free` models.

Measured 2026-11-19 through 9router (3-step task, two runs): Gemini 4
Hydrogen ~5.5 s per request, Argon ~15 s (one Claude Code run hung over
240 s), Carbon ~14–38 s; all cache ~83–84% at a 14k context. Official
prices: Hydrogen $1.50 / $7.50 per 1M tokens; Argon and Carbon $2 / $10,
doubling on 2026-12-01.

## Decision

- Tiers per line: `sol`, `argon`, `carbon` frontier; `terra`, `hydrogen`
  mid; `luna`, `flash`, `lite` fast. The coder weights frontier lower (0.7)
  so a mid tier does the volume; Carbon is penalised as too slow for loops;
  fast avoids 1M-context variants.
- Roles are filled planner → coder → reviewer → fast. Each head is the best
  primary model not already heading another role, preferring another quota
  pool, and never a free model while a paid-for one exists. The rest of the
  chain keeps its plain ranking; free models come after every paid-for
  primary model.
- A short rate limit keeps a provider in the primary part; only an
  exhausted provider or a weekly/monthly limit moves it to standby.
- Gemini is pay-as-you-go; `:free` models are never paid backups; DeepSeek
  is always the last backup. "bootstrap failed" (MiMo) is a permanent
  failure.

## Consequences

- Planner, coder, reviewer and fast start on different models, each from its
  tier; the heaviest role spends a different pool than the planner.
- Suggestions depend on live quota and can change between two refreshes;
  apply all four combos from one refresh.
