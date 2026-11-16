#!/usr/bin/env bash
set -euo pipefail
cd /home/dendro/dev/hivedeck
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export COREPACK_ENABLE_STRICT=0
echo "### pnpm install"
corepack pnpm install --frozen-lockfile 2>&1 | tail -15
echo "### build local-web (frontend)"
corepack pnpm --filter @vibe/local-web run build 2>&1 | tail -30
echo "### dist result"
ls -la packages/local-web/dist/ | head
head -c 150 packages/local-web/dist/index.html
echo
echo "FRONTEND_BUILD_DONE"
