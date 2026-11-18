// Headless Chrome driven over the DevTools protocol, with no dependencies
// (Node 22+ ships WebSocket). Agents use this to test the HiveDeck UI from a
// headless run: it needs no OS permission, no approval and no external
// browser host, unlike Computer Use or a Paradev/Superset browser pane.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

/** The Chrome binary to use: $CHROME_PATH, else the first one installed. */
export function findChrome({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  if (env.CHROME_PATH) {
    if (!exists(env.CHROME_PATH)) {
      throw new Error(`CHROME_PATH does not exist: ${env.CHROME_PATH}`);
    }
    return env.CHROME_PATH;
  }
  const found = (CANDIDATES[platform] ?? []).find((p) => exists(p));
  if (!found) {
    throw new Error(
      'No Chrome/Chromium found. Install Google Chrome or set CHROME_PATH.'
    );
  }
  return found;
}

/** Parse Chrome's DevToolsActivePort file: "<port>\n<browser ws path>". */
export function parseDevToolsActivePort(text) {
  const [port, path] = text.trim().split('\n');
  const n = Number(port);
  if (!Number.isInteger(n) || n <= 0 || !path?.startsWith('/devtools/')) {
    throw new Error(`Unexpected DevToolsActivePort content: ${text}`);
  }
  return { port: n, path };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start headless Chrome and return a page you can drive. */
export async function launch({
  width = 1440,
  height = 900,
  headless = true,
} = {}) {
  if (typeof WebSocket === 'undefined') {
    throw new Error('Node 22+ is required (global WebSocket).');
  }
  const chrome = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'hivedeck-cdp-'));
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    `--window-size=${width},${height}`,
    ...(headless ? ['--headless=new'] : []),
    'about:blank',
  ];
  const proc = spawn(chrome, args, { stdio: 'ignore' });
  let exited = false;
  proc.on('exit', () => (exited = true));

  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) {
    if (exited) throw new Error(`Chrome exited during startup (${chrome})`);
    await sleep(100);
  }
  if (!existsSync(portFile)) {
    proc.kill();
    throw new Error('Chrome did not open a DevTools port within 10s');
  }
  const { port } = parseDevToolsActivePort(readFileSync(portFile, 'utf8'));
  const targets = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  const pageTarget = targets.find((t) => t.type === 'page');
  if (!pageTarget) throw new Error('Chrome has no page target');

  const page = await Page.connect(pageTarget.webSocketDebuggerUrl);
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const close = async () => {
    page.close();
    proc.kill();
    for (let i = 0; i < 30 && !exited; i++) await sleep(100);
    rmSync(profile, { recursive: true, force: true });
  };
  return { page, close };
}

/** One page: navigation, script evaluation, clicks, screenshots, errors. */
export class Page {
  /** Uncaught exceptions and console.error lines seen so far. */
  errors = [];
  #ws;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  static async connect(url) {
    const page = new Page();
    page.#ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      page.#ws.addEventListener('open', resolve, { once: true });
      page.#ws.addEventListener('error', reject, { once: true });
    });
    page.#ws.addEventListener('message', (event) => page.#onMessage(event));
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    page.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => {
      page.errors.push(
        `exception: ${d.exception?.description ?? d.text}`.slice(0, 2000)
      );
    });
    page.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (type !== 'error') return;
      const text = args
        .map((a) => a.value ?? a.description ?? a.type)
        .join(' ');
      page.errors.push(`console.error: ${text}`.slice(0, 2000));
    });
    return page;
  }

  #onMessage(event) {
    const msg = JSON.parse(event.data);
    if (msg.id && this.#pending.has(msg.id)) {
      const { resolve, reject } = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (msg.error)
        reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of this.#listeners.get(msg.method) ?? []) fn(msg.params);
    }
  }

  on(method, fn) {
    const list = this.#listeners.get(method) ?? [];
    list.push(fn);
    this.#listeners.set(method, list);
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) =>
      this.#pending.set(id, { resolve, reject })
    );
  }

  /** Run `expression` in the page (awaits promises) and return its value. */
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(
        exceptionDetails.exception?.description ?? exceptionDetails.text
      );
    }
    return result.value;
  }

  async goto(url, { settleMs = 1500 } = {}) {
    const loaded = new Promise((r) => this.on('Page.loadEventFired', r));
    await this.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(15000)]);
    await sleep(settleMs);
  }

  /** Poll `predicate` (a page expression) until truthy or `timeoutMs`. */
  async waitFor(predicate, { timeoutMs = 15000, intervalMs = 250 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await this.evaluate(predicate).catch(() => false);
      if (value) return value;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for: ${predicate}`);
      }
      await sleep(intervalMs);
    }
  }

  /**
   * Click the first visible button/link whose text or aria-label equals
   * `label`. Returns false when there is none.
   */
  async click(label) {
    return this.evaluate(`(() => {
      const want = ${JSON.stringify(label)};
      const els = [...document.querySelectorAll('button, a, [role="button"]')];
      const el = els.find((e) =>
        (e.innerText?.trim() === want || e.getAttribute('aria-label') === want)
        && e.getClientRects().length > 0);
      if (!el) return false;
      el.click();
      return true;
    })()`);
  }

  /**
   * Save a screenshot. The file extension picks the format: `.jpg`/`.jpeg`
   * saves a compressed JPEG (several times smaller than PNG), anything else
   * a PNG. Prefer `.jpg` for screenshots an agent will look at: each image
   * an agent reads stays in its context for the rest of the session, and
   * some model routes count it as text (a PNG can cost 100k+ tokens).
   * `scale` shrinks the capture (0.5 = half width and height).
   */
  async screenshot(path, { quality = 70, scale = 1 } = {}) {
    const jpeg = /\.jpe?g$/i.test(path);
    const params = jpeg ? { format: 'jpeg', quality } : { format: 'png' };
    if (scale !== 1) {
      const { cssLayoutViewport: v } = await this.send(
        'Page.getLayoutMetrics'
      );
      params.clip = {
        x: 0,
        y: 0,
        width: v.clientWidth,
        height: v.clientHeight,
        scale,
      };
    }
    const { data } = await this.send('Page.captureScreenshot', params);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from(data, 'base64'));
    return path;
  }

  close() {
    this.#ws?.close();
  }
}
