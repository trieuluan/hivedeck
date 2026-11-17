# ADR-037: Headless-Chrome UI testing for agents

- **Status:** Accepted
- **Date:** 2026-11-18

## Context

Card agents could not test the HiveDeck UI. HIVE-2 (a Codex run) tried two browser tools and both failed in a headless HiveDeck run:

- Codex Computer Use: `Computer Use was not approved to use Google Chrome`. Controlling the user's real Chrome needs the owner's approval, and nobody is there to approve during a headless run.
- The `superset-browser` skill (Paradev/Superset): its `superset` CLI is not on the agent's PATH, so the browser host was unavailable.

The repo had no browser tooling of its own, so agents fell back to unit tests and builds. A later run showed that launching headless Chrome with a DevTools port works without any permission.

## Decision

The repo ships its own browser tooling, with no new dependencies:

- `scripts/browser/cdp.mjs`: launches headless Chrome (`--remote-debugging-port=0`, throwaway profile) and drives a page over the DevTools protocol using Node's built-in WebSocket: `goto`, `click(label)`, `evaluate`, `waitFor`, `screenshot`, collected `errors`.
- `pnpm run ui:smoke [URL]`: a real UI smoke test of a running app covering the home, a project board, a workspace, and project ↔ workspace navigation. It fails on uncaught exceptions, React fatals (hook order, `removeChild`, duplicate DnD backends), the error screen, or a doubled page.
- `AGENTS.md` / `CLAUDE.md` tell agents to use these instead of Computer Use or a Paradev browser host.
- `pnpm run test:browser-tools` unit-tests the pure helpers.

## Consequences

- Agents can verify UI changes and catch the crashes seen so far without the owner's involvement. Removing the hooks-order fix in `ProjectKanban` makes `ui:smoke` fail (checked).
- It needs Chrome/Chromium on the machine (or `CHROME_PATH`) and a running app; the smoke test does not start the app itself.
- It is not a full end-to-end suite: it covers navigation health, not feature behaviour. Feature checks are scripted per task with `cdp.mjs`.
