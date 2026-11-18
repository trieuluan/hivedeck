# ADR-042: Show provider spend from 9router's usage records

- **Status**: Accepted
- **Date**: 2026-11-19

## Context

Pay-as-you-go providers (Gemini API key, DeepSeek, OpenRouter) showed "no
quota data". 9router fetches usage only for OAuth connections and for the
API-key providers it flags as having a usage API (DeepSeek's balance), and
Google offers no API that reports remaining quota or spend for an API key.
9router does, however, record every request with its tokens and a cost
priced from its own pricing table (`usageHistory`, `/api/usage/stats`).

## Decision

- The Combo tab's provider rows show, from `/api/usage/stats?period=today`
  and `period=30d`:
  - pay-as-you-go: money spent today and over the last 30 days;
  - subscriptions: what the same use would cost at API prices (muted);
  - unpriced providers: tokens over 30 days.
- The figures are labelled as 9router's estimate; the provider's billing
  page has the real bill.

## Consequences

- Spend is visible without HiveDeck reading any provider key.
- Accuracy follows 9router's pricing table (editable in its dashboard);
  models it has no price for show tokens only.
