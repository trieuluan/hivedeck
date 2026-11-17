#!/usr/bin/env node
// Real UI smoke test of a running HiveDeck: drives headless Chrome through
// the main screens and the navigations that have crashed before, and fails
// on crashes, React errors or a doubled page.
//
//   pnpm run ui:smoke                      # app on http://localhost:3001
//   pnpm run ui:smoke -- http://localhost:3005
//   HIVEDECK_URL=... pnpm run ui:smoke -- --out /tmp/shots
//
// Exit codes: 0 pass, 1 UI failures, 2 app not reachable / no browser.

import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** React/runtime errors that mean the UI is broken, even if logged only. */
export const FATAL_CONSOLE = [
  /Rendered (fewer|more) hooks than expected/,
  /removeChild/,
  /Cannot have two HTML5 backends/,
  /Maximum update depth exceeded/,
  /The above error occurred in/,
];

/** Known noise that isn't a UI failure (reported, not failed). */
export const IGNORED_CONSOLE = [/Shape sync error/];

export function parseArgs(argv, env = process.env) {
  const args = { url: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--') continue;
    else if (!a.startsWith('-')) args.url = a;
  }
  args.url = (
    args.url ??
    env.HIVEDECK_URL ??
    `http://localhost:${env.FRONTEND_PORT ?? 3001}`
  ).replace(/\/$/, '');
  args.out ??= join(tmpdir(), `hivedeck-ui-smoke-${Date.now()}`);
  return args;
}

/** Split page errors into failures and warnings. */
export function classifyErrors(errors) {
  const failures = [];
  const warnings = [];
  for (const e of errors) {
    if (IGNORED_CONSOLE.some((r) => r.test(e))) warnings.push(e);
    else if (e.startsWith('exception:')) failures.push(e);
    else if (FATAL_CONSOLE.some((r) => r.test(e))) failures.push(e);
    else warnings.push(e);
  }
  return { failures, warnings };
}

/** Every translation of a common.json key, so clicks work in any locale. */
function labels(path) {
  const out = [];
  for (const lang of ['en', 'vi']) {
    const file = join(
      ROOT,
      `packages/web-core/src/i18n/locales/${lang}/common.json`
    );
    let node = JSON.parse(readFileSync(file, 'utf8'));
    for (const part of path.split('.')) node = node?.[part];
    if (typeof node === 'string') out.push(node);
  }
  return out;
}

const HEALTH = `(() => ({
  path: location.pathname,
  crashed: document.body.innerText.includes('Something went wrong'),
  trees: document.querySelectorAll('[role="tree"]').length,
  ready: document.querySelectorAll('aside').length > 0,
}))()`;

async function main() {
  const { url, out } = parseArgs(process.argv.slice(2));
  mkdirSync(out, { recursive: true });

  let projects, workspaces;
  try {
    projects = (await (await fetch(`${url}/api/projects`)).json()).data
      .projects;
    workspaces = (await (await fetch(`${url}/api/workspaces`)).json()).data;
  } catch (e) {
    console.error(
      `HiveDeck is not reachable at ${url} (${e.message}).\n` +
        'Start it with `pnpm run dev`, or pass the URL of the running app.'
    );
    process.exit(2);
  }

  let browser;
  try {
    browser = await launch();
  } catch (e) {
    console.error(`Could not start headless Chrome: ${e.message}`);
    process.exit(2);
  }
  const { page } = browser;
  const failures = [];
  const steps = [];

  const check = async (name, expectPath) => {
    let h;
    try {
      h = await page.waitFor(
        `(() => { const h = ${HEALTH}; return h.ready || h.crashed ? h : null; })()`
      );
    } catch {
      h = await page.evaluate(HEALTH);
    }
    const shot = await page.screenshot(
      join(out, `${steps.length + 1}-${name}.png`)
    );
    const problems = [];
    if (h.crashed) problems.push('error screen ("Something went wrong")');
    if (!h.ready) problems.push('app shell never rendered');
    if (h.trees > 1) problems.push(`${h.trees} sidebar trees (doubled page)`);
    if (expectPath && !expectPath.test(h.path)) {
      problems.push(`expected ${expectPath} but at ${h.path}`);
    }
    steps.push({ name, path: h.path, ok: problems.length === 0, shot });
    for (const p of problems) failures.push(`${name}: ${p}`);
  };

  try {
    await page.goto(`${url}/`);
    await check('home');

    const project = projects[0];
    if (!project) {
      console.warn('No project yet: only the home screen was checked.');
    } else {
      await page.goto(`${url}/projects/${project.id}`);
      await check('project-board', /^\/projects\//);

      // Project → workspace through the UI (crashed before: hooks order).
      const openWs = labels('ui.openWorkspace');
      let clicked = false;
      for (const label of openWs) {
        if ((clicked = await page.click(label))) break;
      }
      if (clicked) {
        await check('project-to-workspace', /^\/workspaces\//);

        // Workspace → project board from the sidebar (crashed before).
        let back = false;
        for (const label of labels('sidebar.openProjectPage')) {
          if ((back = await page.click(label))) break;
        }
        if (back) await check('workspace-to-project', /^\/projects\//);
        else failures.push('workspace-to-project: no "open project" button');
      } else {
        console.warn('No "Open workspace" button on the board: step skipped.');
      }
    }

    const ws = workspaces.find((w) => !w.archived) ?? workspaces[0];
    if (ws) {
      await page.goto(`${url}/workspaces/${ws.id}`);
      await check('workspace', /^\/workspaces\//);
    }
  } finally {
    const { failures: errs, warnings } = classifyErrors(page.errors);
    failures.push(...errs);
    for (const s of steps) {
      console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name.padEnd(22)} ${s.path}`);
    }
    for (const w of [...new Set(warnings)].slice(0, 10)) {
      console.log(`warn ${w.slice(0, 200)}`);
    }
    console.log(`screenshots: ${out}`);
    await browser.close();
  }

  if (failures.length) {
    console.error(`\n${failures.length} UI failure(s):`);
    for (const f of [...new Set(failures)])
      console.error(`- ${f.slice(0, 500)}`);
    process.exit(1);
  }
  console.log('\nUI smoke passed.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
