#!/usr/bin/env bash
set -euo pipefail

# HiveDeck dev server expects fixed ports. Fail fast if they are already in use
# so the agent/user gets a clear message instead of a broken CORS/UI state.

FRONTEND_PORT="${FRONTEND_PORT:-3001}"
BACKEND_PORT="${BACKEND_PORT:-3002}"
PREVIEW_PROXY_PORT="${PREVIEW_PROXY_PORT:-3003}"

in_use=()
for p in "$FRONTEND_PORT" "$BACKEND_PORT" "$PREVIEW_PROXY_PORT"; do
  if nc -z 127.0.0.1 "$p" 2>/dev/null || lsof -i :"$p" >/dev/null 2>&1; then
    in_use+=("$p")
  fi
done

if [ ${#in_use[@]} -ne 0 ]; then
  echo "ERROR: HiveDeck dev ports already in use: ${in_use[*]}" >&2
  echo "A stale HiveDeck/frontend/backend process is probably still running." >&2
  echo "Either stop it or override ports: FRONTEND_PORT=3101 BACKEND_PORT=3102 PREVIEW_PROXY_PORT=3103 pnpm run dev" >&2
  exit 1
fi
