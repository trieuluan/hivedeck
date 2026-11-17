import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, parseDevToolsActivePort } from './cdp.mjs';
import { classifyErrors, parseArgs } from './ui-smoke.mjs';

test('findChrome prefers CHROME_PATH, then the first installed browser', () => {
  assert.equal(
    findChrome({ env: { CHROME_PATH: '/x/chrome' }, exists: () => true }),
    '/x/chrome'
  );
  assert.throws(
    () => findChrome({ env: { CHROME_PATH: '/nope' }, exists: () => false }),
    /CHROME_PATH does not exist/
  );
  const installed = '/Applications/Chromium.app/Contents/MacOS/Chromium';
  assert.equal(
    findChrome({ env: {}, platform: 'darwin', exists: (p) => p === installed }),
    installed
  );
  assert.throws(
    () => findChrome({ env: {}, platform: 'darwin', exists: () => false }),
    /No Chrome\/Chromium found/
  );
});

test('parseDevToolsActivePort reads the port and browser path', () => {
  assert.deepEqual(parseDevToolsActivePort('51902\n/devtools/browser/abc\n'), {
    port: 51902,
    path: '/devtools/browser/abc',
  });
  assert.throws(() => parseDevToolsActivePort('garbage'), /Unexpected/);
});

test('classifyErrors fails on crashes and React fatals, not on noise', () => {
  const { failures, warnings } = classifyErrors([
    'exception: TypeError: x is undefined',
    'console.error: Rendered fewer hooks than expected.',
    "console.error: Failed to execute 'removeChild' on 'Node'",
    'console.error: Shape sync error: [object Object]',
    'console.error: some other log',
  ]);
  assert.equal(failures.length, 3);
  assert.deepEqual(warnings, [
    'console.error: Shape sync error: [object Object]',
    'console.error: some other log',
  ]);
});

test('parseArgs takes a URL argument, HIVEDECK_URL, or FRONTEND_PORT', () => {
  assert.equal(
    parseArgs(['--', 'http://localhost:3005/'], {}).url,
    'http://localhost:3005'
  );
  assert.equal(parseArgs([], { HIVEDECK_URL: 'http://h:1' }).url, 'http://h:1');
  assert.equal(
    parseArgs([], { FRONTEND_PORT: '4000' }).url,
    'http://localhost:4000'
  );
  assert.equal(parseArgs(['--out', '/tmp/s'], {}).out, '/tmp/s');
});
