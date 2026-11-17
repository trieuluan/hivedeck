> **HiveDeck** — the independent, self-hosted fork of vibe-kanban, built for a **single-developer process** (no team, no cloud, no auth). The TUI cockpit (`crates/tui`, `hivedeck-tui`) and Telegram channel orchestration (`crates/telegram-bridge`) are the control surfaces a solo dev uses to drive a crew of agents.

# Repository Guidelines

## Project Structure & Module Organization
- `crates/`: Rust workspace crates — `server` (API + bins), `db` (SQLx models/migrations), `executors`, `services`, `utils`, `git` (Git operations), `api-types` (shared API types), `review` (PR review tool), `deployment`, `local-deployment`, `tui` (terminal cockpit, `hivedeck-tui` bin), `telegram-bridge` (send-only escalation daemon, `hivedeck-telegram-bridge` bin).
- `automation/`: Automated-supervision layer (TUI + Telegram bridge + PM agent) — see [`automation/README.md`](automation/README.md). Telegram config lives in `~/.hivedeck/telegram.toml` (example: `automation/telegram.toml.example`).
- `packages/local-web/`: Local React + TypeScript app entrypoint (Vite, Tailwind). Shell source in `packages/local-web/src`.
- `packages/web-core/`: Shared React + TypeScript frontend library used by local-web (`packages/web-core/src`).
- `shared/`: Generated TypeScript types (`shared/types.ts`) and agent tool schemas (`shared/schemas/`). Do not edit generated files directly.
- `assets/`, `dev_assets_seed/`, `dev_assets/`: Packaged and local dev assets.
- `npx-cli/`: Files published to the npm CLI package.
- `scripts/`: Dev helpers (ports, DB preparation).
- `docs/`: Documentation files.

### Crate-specific guides
- [`docs/AGENTS.md`](docs/AGENTS.md) — Mintlify documentation writing guidelines and component reference.
- [`packages/local-web/AGENTS.md`](packages/local-web/AGENTS.md) — Web app design system styling guidelines.

## Architecture Decision Records

All ADRs live in **`docs/ADR/`** as `.md` files (numbered, e.g. `ADR-001-modal-system.md`, with `Status`/`Date`/`Context`/`Decision`/`Consequences`). **Highly advisable to maintain documentation here**: when a non-trivial architecture decision is made (new subsystem, refactor, pattern choice, removed feature), record it as an ADR before or right after the implementation, and keep `Status` accurate (`Accepted` vs `Proposed`). Agents should check `docs/ADR/` for prior decisions before proposing alternatives.

## Legacy cloud/remote code

The fork is local-only; the cloud stack has been removed. The following crates were deleted from disk: `crates/remote`, `crates/relay-tunnel`, `crates/relay-hosts`, `crates/relay-webrtc`, `crates/remote-info`. The `remote:*` scripts in `package.json` and the `backend-remote-checks` CI job have been removed as well. Do not reintroduce them.

Note: `shared/remote-types.ts` (historically generated from `crates/remote`) is NOT dead — it is the live wire-contract for the kanban data layer (`providers/remote/*`, `integrations/electric/*`, `lib/electric/*`), used by the local UI in fallback-REST mode. Keep it and its consumers; treat it as a frozen, hand-maintained contract since its generator has been removed.

## Managing Shared Types Between Rust and TypeScript

ts-rs allows you to derive TypeScript types from Rust structs/enums. By annotating your Rust types with #[derive(TS)] and related macros, ts-rs will generate .ts declaration files for those types.
When making changes to the types, you can regenerate them using `pnpm run generate-types`
Do not manually edit shared/types.ts, instead edit crates/server/src/bin/generate_types.rs

## Build, Test, and Development Commands
- Install: `pnpm i`
- Run dev (web app + backend with ports auto-assigned): `pnpm run dev`
- Backend (watch): `pnpm run backend:dev:watch`
- Web app (dev): `pnpm run local-web:dev`
- Type checks: `pnpm run check` (frontend + all backend Rust workspaces) and `pnpm run backend:check` (all backend Rust workspaces in the workspace)
- Rust tests: `cargo test --workspace`
- Generate TS types from Rust: `pnpm run generate-types` (or `generate-types:check` in CI)
- Prepare SQLx (offline): `pnpm run prepare-db`
- Local NPX build: `pnpm run build:npx` then `pnpm pack` in `npx-cli/`
- Format code: `pnpm run format` (runs `cargo fmt` for all backend Rust workspaces + web-core/web Prettier)
- Lint: `pnpm run lint` (runs web/ui ESLint + `cargo clippy` for all backend Rust workspaces)

## UI testing (agents)

Headless agent runs cannot use Computer Use or a Paradev/Superset browser pane: Computer Use needs the owner to approve control of Chrome (nobody can approve in a headless run), and the `superset` browser CLI is not installed here. Test the UI with headless Chrome instead (no permission needed; Node 22+ and an installed Chrome/Chromium, or `CHROME_PATH`):

- `pnpm run ui:smoke [URL]` — real UI smoke test of a running app (default `http://localhost:3001`; pass your worktree dev server's URL). It opens the home, a project board, a workspace, and the project ↔ workspace navigations that have crashed before; it fails on uncaught errors, React fatals, the error screen, or a doubled page, and prints where the screenshots are.
- For your own checks, script `scripts/browser/cdp.mjs`:

  ```js
  import { launch } from './scripts/browser/cdp.mjs';
  const { page, close } = await launch();          // headless Chrome
  await page.goto('http://localhost:3001/projects/<id>');
  await page.click('Open workspace');               // text or aria-label
  await page.waitFor(`location.pathname.startsWith('/workspaces/')`);
  console.log(await page.evaluate('document.title'), page.errors);
  await page.screenshot('/tmp/after.png');
  await close();
  ```

Say in your report what you verified in the browser and what you could not.

## UI testing (agents)

Headless agent runs cannot use Computer Use or a Paradev/Superset browser pane: Computer Use needs the owner to approve control of Chrome (nobody can approve in a headless run), and the `superset` browser CLI is not installed here. Test the UI with headless Chrome instead (no permission needed; Node 22+ and an installed Chrome/Chromium, or `CHROME_PATH`):

- `pnpm run ui:smoke [URL]` — real UI smoke test of a running app (default `http://localhost:3001`; pass your worktree dev server's URL). It opens the home, a project board, a workspace, and the project ↔ workspace navigations that have crashed before; it fails on uncaught errors, React fatals, the error screen, or a doubled page, and prints where the screenshots are.
- For your own checks, script `scripts/browser/cdp.mjs`:

  ```js
  import { launch } from './scripts/browser/cdp.mjs';
  const { page, close } = await launch();          // headless Chrome
  await page.goto('http://localhost:3001/projects/<id>');
  await page.click('Open workspace');               // text or aria-label
  await page.waitFor(`location.pathname.startsWith('/workspaces/')`);
  console.log(await page.evaluate('document.title'), page.errors);
  await page.screenshot('/tmp/after.png');
  await close();
  ```

Say in your report what you verified in the browser and what you could not.

## Before Completing a Task
- Run `pnpm run format` to format all Rust workspaces and web code.

## Coding Style & Naming Conventions
- Rust: `rustfmt` enforced (`rustfmt.toml`); group imports by crate; snake_case modules, PascalCase types.
- TypeScript/React: ESLint + Prettier (2 spaces, single quotes, 80 cols). PascalCase components, camelCase vars/functions, kebab-case file names where practical.
- Keep functions small, add `Debug`/`Serialize`/`Deserialize` where useful.

## Testing Guidelines
- Rust: prefer unit tests alongside code (`#[cfg(test)]`), run `cargo test --workspace`. Add tests for new logic and edge cases.
- Web app: ensure `pnpm run check` and `pnpm run lint` pass. If adding runtime logic, include lightweight tests (e.g., Vitest) in the same directory.

## Security & Config Tips
- Use `.env` for local overrides; never commit secrets. Key envs: `FRONTEND_PORT`, `BACKEND_PORT`, `HOST`
- Dev ports are fixed: frontend `3001`, backend `3002`, preview proxy `3003`. Dev assets live in `dev_assets/` (seeded from `dev_assets_seed/`).


