import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'dev-isolated.sh');

function parseEnvOutput(stdout) {
  const out = {};
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    const idx = line.indexOf('=');
    if (idx > 0) out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function runScript(extraEnv) {
  const baseEnv = {
    PATH: process.env.PATH,
    HOME: '/tmp/fake-real-home',
    TMPDIR: '/tmp/fake-real-tmp',
    FRONTEND_PORT: '3001',
    BACKEND_PORT: '3002',
    PREVIEW_PROXY_PORT: '3003',
    VK_ALLOWED_ORIGINS: 'http://localhost:3001',
  };
  const stdout = execFileSync('bash', [SCRIPT, '--print-env'], {
    cwd: ROOT,
    env: { ...baseEnv, ...extraEnv },
    encoding: 'utf8',
  });
  return parseEnvOutput(stdout);
}

test('no-op when neither VK_WORKSPACE_ID nor HIVEDECK_ISOLATED is set', () => {
  const env = runScript({});
  assert.equal(env.HOME, '/tmp/fake-real-home');
  assert.equal(env.TMPDIR, '/tmp/fake-real-tmp');
  assert.equal(env.FRONTEND_PORT, '3001');
  assert.equal(env.BACKEND_PORT, '3002');
  assert.equal(env.PREVIEW_PROXY_PORT, '3003');
  assert.equal(env.HIVEDECK_ISOLATION_ACTIVE, undefined);
});

test('isolates env and reassigns inherited live ports when VK_WORKSPACE_ID is set', () => {
  const wsId = `test-ws-${process.pid}`;
  const sandboxHome = `/tmp/hivedeck-${wsId}`;
  const sandboxTmp = `/tmp/hivedeck-tmp-${wsId}`;
  try {
    const env = runScript({ VK_WORKSPACE_ID: wsId });
    assert.equal(env.DISABLE_WORKTREE_CLEANUP, '1');
    assert.equal(env.SQLX_OFFLINE, 'true');
    assert.equal(env.HIVEDECK_ISOLATION_ACTIVE, '1');
    assert.equal(env.CARGO_HOME, '/tmp/fake-real-home/.cargo');
    assert.equal(env.RUSTUP_HOME, '/tmp/fake-real-home/.rustup');
    assert.equal(env.HOME, sandboxHome);
    assert.equal(env.TMPDIR, sandboxTmp);
    assert.equal(env.HIVEDECK_ASSET_DIR, `${sandboxHome}/dev_assets`);
    assert.ok(env.CARGO_TARGET_DIR.endsWith(`/.target-isolated/${wsId}`));
    assert.notEqual(env.FRONTEND_PORT, '3001');
    assert.notEqual(env.BACKEND_PORT, '3002');
    assert.notEqual(env.PREVIEW_PROXY_PORT, '3003');
    assert.equal(
      new Set([env.FRONTEND_PORT, env.BACKEND_PORT, env.PREVIEW_PROXY_PORT])
        .size,
      3
    );
    assert.equal(
      env.VK_ALLOWED_ORIGINS,
      `http://localhost:${env.FRONTEND_PORT}`
    );
  } finally {
    rmSync(sandboxHome, { recursive: true, force: true });
    rmSync(sandboxTmp, { recursive: true, force: true });
  }
});

test('keeps explicit non-default free ports while replacing default proxy port', () => {
  const tmpBase = mkdtempSync(join(tmpdir(), 'hd-iso-test-'));
  try {
    const env = runScript({
      HIVEDECK_ISOLATED: 'true',
      HIVEDECK_ISOLATED_HOME: join(tmpBase, 'home'),
      HIVEDECK_ISOLATED_TMPDIR: join(tmpBase, 'tmp'),
      FRONTEND_PORT: '44101',
      BACKEND_PORT: '44102',
      PREVIEW_PROXY_PORT: '3003',
    });
    assert.equal(env.FRONTEND_PORT, '44101');
    assert.equal(env.BACKEND_PORT, '44102');
    assert.notEqual(env.PREVIEW_PROXY_PORT, '3003');
    assert.equal(env.VK_ALLOWED_ORIGINS, 'http://localhost:44101');
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
});
