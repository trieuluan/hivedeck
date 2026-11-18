#!/usr/bin/env bash
set -euo pipefail

# Isolate HiveDeck workspace/browser-debug dev servers from the owner's live
# server (ports 3001/3002/3003, ~/.hivedeck-dev, $TMPDIR/hivedeck.port, and
# shared dev_assets/db.v2.sqlite). No-op unless running inside a HiveDeck
# workspace (VK_WORKSPACE_ID) or explicitly enabled (HIVEDECK_ISOLATED=1 / --force).

is_truthy() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

FORCE=0
PRINT_ENV=0
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --print-env) PRINT_ENV=1; shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done

run_next() {
  if [ "$PRINT_ENV" -eq 1 ]; then
    env | grep -E '^(DISABLE_WORKTREE_CLEANUP|SQLX_OFFLINE|CARGO_TARGET_DIR|CARGO_HOME|RUSTUP_HOME|HOME|TMPDIR|HIVEDECK_ASSET_DIR|HIVEDECK_ISOLATION_ACTIVE|FRONTEND_PORT|BACKEND_PORT|PREVIEW_PROXY_PORT|VK_ALLOWED_ORIGINS|VK_DISABLE_BROWSER_OPEN|VITE_OPEN)=' | sort
  fi
  if [ $# -gt 0 ]; then
    exec "$@"
  fi
}

if is_truthy "${HIVEDECK_NO_ISOLATE:-}"; then
  run_next "$@"
  exit 0
fi

if [ "$FORCE" -eq 0 ] \
  && [ -z "${VK_WORKSPACE_ID:-}" ] \
  && ! is_truthy "${HIVEDECK_ISOLATED:-}" \
  && ! is_truthy "${VK_ISOLATED:-}" \
  && ! is_truthy "${ISOLATED:-}"; then
  run_next "$@"
  exit 0
fi

if [ "${HIVEDECK_ISOLATION_ACTIVE:-0}" = "1" ]; then
  run_next "$@"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

RAW_WS="${VK_WORKSPACE_ID:-${HIVEDECK_WORKSPACE_ID:-}}"
if [ -z "$RAW_WS" ]; then
  PATH_HASH="$(printf '%s' "$REPO_ROOT" | cksum | awk '{print $1}')"
  RAW_WS="$(basename "$REPO_ROOT")-${PATH_HASH}"
fi
WORKSPACE_SLUG="$(printf '%s' "$RAW_WS" | tr -c 'A-Za-z0-9._-' '-' | sed 's/^-*//;s/-*$//')"
[ -n "$WORKSPACE_SLUG" ] || WORKSPACE_SLUG="workspace"

export DISABLE_WORKTREE_CLEANUP=1
export SQLX_OFFLINE=true
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${REPO_ROOT}/.target-isolated/${WORKSPACE_SLUG}}"

REAL_HOME="${HOME:-}"
if [ -n "$REAL_HOME" ]; then
  export CARGO_HOME="${CARGO_HOME:-${REAL_HOME}/.cargo}"
  export RUSTUP_HOME="${RUSTUP_HOME:-${REAL_HOME}/.rustup}"
  if [ -z "${PNPM_HOME:-}" ]; then
    if [ -d "${REAL_HOME}/Library/pnpm" ]; then
      export PNPM_HOME="${REAL_HOME}/Library/pnpm"
    elif [ -d "${REAL_HOME}/.local/share/pnpm" ]; then
      export PNPM_HOME="${REAL_HOME}/.local/share/pnpm"
    fi
  fi
  export npm_config_cache="${npm_config_cache:-${REAL_HOME}/.npm}"
  export XDG_CACHE_HOME="${XDG_CACHE_HOME:-${REAL_HOME}/.cache}"
fi

export HOME="${HIVEDECK_ISOLATED_HOME:-/tmp/hivedeck-${WORKSPACE_SLUG}}"
export TMPDIR="${HIVEDECK_ISOLATED_TMPDIR:-/tmp/hivedeck-tmp-${WORKSPACE_SLUG}}"
mkdir -p "$HOME" "$TMPDIR"

export HIVEDECK_ASSET_DIR="${HIVEDECK_ASSET_DIR:-${HOME}/dev_assets}"
mkdir -p "$HIVEDECK_ASSET_DIR"

# Seed isolated DB if missing; sanitize any running rows so startup cleanup
# never touches live tmux sessions from the source instance.
DST_DB="${HIVEDECK_ASSET_DIR}/db.v2.sqlite"
if [ ! -f "$DST_DB" ]; then
  SRC_DB=""
  if [ -f "${REPO_ROOT}/dev_assets/db.v2.sqlite" ]; then
    SRC_DB="${REPO_ROOT}/dev_assets/db.v2.sqlite"
  elif GIT_COMMON="$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null || true)" && [ -n "$GIT_COMMON" ]; then
    MAIN_ROOT="$(cd "$REPO_ROOT" && cd "$GIT_COMMON/.." 2>/dev/null && pwd || true)"
    if [ -n "$MAIN_ROOT" ] && [ -f "${MAIN_ROOT}/dev_assets/db.v2.sqlite" ]; then
      SRC_DB="${MAIN_ROOT}/dev_assets/db.v2.sqlite"
    fi
  fi

  if [ -n "$SRC_DB" ] && [ -f "$SRC_DB" ]; then
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 "$SRC_DB" ".backup '$DST_DB'" 2>/dev/null || cp "$SRC_DB" "$DST_DB"
      sqlite3 "$DST_DB" "UPDATE execution_processes SET status = 'killed' WHERE status = 'running';" 2>/dev/null || true
    else
      cp "$SRC_DB" "$DST_DB"
    fi
    SRC_DIR="$(dirname "$SRC_DB")"
    if [ -f "${SRC_DIR}/profiles.json" ] && [ ! -f "${HIVEDECK_ASSET_DIR}/profiles.json" ]; then
      cp "${SRC_DIR}/profiles.json" "${HIVEDECK_ASSET_DIR}/profiles.json"
    fi
  fi
fi

# Pick free ports whenever inherited live-server defaults (3001/3002/3003)
# or occupied/colliding ports are present.
pick_ports() {
  if command -v node >/dev/null 2>&1; then
    node -e '
      const net = require("node:net");
      const defaults = [3001, 3002, 3003];
      const requested = [
        process.env.FRONTEND_PORT,
        process.env.BACKEND_PORT,
        process.env.PREVIEW_PROXY_PORT,
      ];
      function canBind(port) {
        return new Promise((resolve) => {
          const s = net.createServer();
          s.unref();
          s.once("error", () => resolve(false));
          s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
        });
      }
      function freePort(used) {
        return new Promise((resolve, reject) => {
          const tryOnce = () => {
            const s = net.createServer();
            s.unref();
            s.once("error", reject);
            s.listen(0, "127.0.0.1", () => {
              const { port } = s.address();
              s.close(() => (used.has(port) ? tryOnce() : resolve(port)));
            });
          };
          tryOnce();
        });
      }
      (async () => {
        const used = new Set();
        const out = [];
        for (let i = 0; i < 3; i++) {
          const raw = Number(requested[i]);
          let chosen =
            Number.isInteger(raw) &&
            raw > 0 &&
            raw < 65536 &&
            raw !== defaults[i] &&
            !used.has(raw) &&
            (await canBind(raw))
              ? raw
              : await freePort(used);
          used.add(chosen);
          out.push(chosen);
        }
        process.stdout.write(out.join(" ") + "\n");
      })();
    '
  else
    python3 -c '
import os, socket
defaults = (3001, 3002, 3003)
reqs = [os.environ.get("FRONTEND_PORT"), os.environ.get("BACKEND_PORT"), os.environ.get("PREVIEW_PROXY_PORT")]
used = set()
out = []
for i, raw in enumerate(reqs):
    chosen = None
    if raw and raw.isdigit():
        p = int(raw)
        if 0 < p < 65536 and p != defaults[i] and p not in used:
            try:
                with socket.socket() as s:
                    s.bind(("127.0.0.1", p))
                    chosen = p
            except OSError:
                pass
    while chosen is None:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            p = s.getsockname()[1]
        if p not in used:
            chosen = p
    used.add(chosen)
    out.append(str(chosen))
print(" ".join(out))
'
  fi
}

read -r FRONTEND_PORT BACKEND_PORT PREVIEW_PROXY_PORT <<<"$(pick_ports)"
export FRONTEND_PORT BACKEND_PORT PREVIEW_PROXY_PORT

ORIGIN="http://localhost:${FRONTEND_PORT}"
if [ -z "${VK_ALLOWED_ORIGINS:-}" ] || [ "${VK_ALLOWED_ORIGINS}" = "http://localhost:3001" ]; then
  export VK_ALLOWED_ORIGINS="$ORIGIN"
else
  case ",${VK_ALLOWED_ORIGINS}," in
    *",${ORIGIN},"*) ;;
    *) export VK_ALLOWED_ORIGINS="${VK_ALLOWED_ORIGINS},${ORIGIN}" ;;
  esac
fi

export VITE_OPEN="${VITE_OPEN:-false}"
export VK_DISABLE_BROWSER_OPEN=1
export HIVEDECK_ISOLATION_ACTIVE=1

echo "[hivedeck-isolated] ws=${WORKSPACE_SLUG} frontend=${ORIGIN} backend=${BACKEND_PORT} proxy=${PREVIEW_PROXY_PORT} home=${HOME} tmpdir=${TMPDIR} assets=${HIVEDECK_ASSET_DIR} target=${CARGO_TARGET_DIR}" >&2

run_next "$@"
