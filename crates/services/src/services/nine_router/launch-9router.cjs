// HiveDeck launcher for HiveRouter (see docs/ADR/ADR-026-embedded-9router.md).
//
// Runs HiveRouter's standalone Next.js server directly, skipping its CLI (tray
// icon, self-update, interactive menu, "kill previous instance"). HiveDeck
// passes PORT and HOSTNAME in the environment.
//
// Tool-output image normalization, Antigravity image support, and Responses
// API MCP namespace flattening are built natively into @trieuluan/hiverouter.
//
// Usage: node launch-9router.cjs <path to the @trieuluan/hiverouter npm package>
'use strict';

const fs = require('fs');
const path = require('path');

const pkgDir = process.argv[2];
if (!pkgDir || !fs.existsSync(path.join(pkgDir, 'package.json'))) {
  console.error(`[hivedeck] hiverouter package not found at: ${pkgDir}`);
  process.exit(2);
}

const appDir = path.join(pkgDir, 'app');

// HiveRouter keeps its SQLite engine in a runtime folder under ~/.9router and
// resolves it through NODE_PATH. Mirror what its CLI does before booting.
try {
  const runtime = require(path.join(pkgDir, 'hooks', 'sqliteRuntime.js'));
  runtime.ensureSqliteRuntime({ silent: true });
  process.env.NODE_PATH = runtime.buildEnvWithRuntime(process.env).NODE_PATH;
  require('module').Module._initPaths();
} catch (err) {
  console.error(`[hivedeck] SQLite runtime setup skipped: ${err && err.message}`);
}

const customServer = path.join(appDir, 'custom-server.js');
const standaloneServer = path.join(appDir, 'server.js');

if (!fs.existsSync(standaloneServer)) {
  console.error(`[hivedeck] hiverouter standalone server not found in ${appDir}`);
  process.exit(2);
}

console.log(
  `[hivedeck] starting hiverouter from ${pkgDir} on ${process.env.HOSTNAME}:${process.env.PORT}`
);
process.chdir(appDir);
// custom-server.js wraps http.createServer (real client IP, h2c downgrade)
// but only boots the server itself when it is the main module, so load it
// for its side effects and then boot the standalone server explicitly.
if (fs.existsSync(customServer)) require(customServer);
require(standaloneServer);
