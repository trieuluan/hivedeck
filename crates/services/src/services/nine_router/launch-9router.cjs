// HiveDeck launcher for 9router (see docs/ADR/ADR-026-embedded-9router.md).
//
// Runs 9router's standalone Next.js server directly, skipping its CLI (tray
// icon, self-update, interactive menu, "kill previous instance"). HiveDeck
// passes PORT and HOSTNAME in the environment.
//
// Usage: node launch-9router.cjs <path to the 9router npm package>
'use strict';

const fs = require('fs');
const path = require('path');

const pkgDir = process.argv[2];
if (!pkgDir || !fs.existsSync(path.join(pkgDir, 'package.json'))) {
  console.error(`[hivedeck] 9router package not found at: ${pkgDir}`);
  process.exit(2);
}

const appDir = path.join(pkgDir, 'app');

// 9router keeps its SQLite engine in a runtime folder under ~/.9router and
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
  console.error(`[hivedeck] 9router standalone server not found in ${appDir}`);
  process.exit(2);
}

// Extract image URL (`data:image/...;base64,...` or `https://...`) from an
// OpenAI Responses / Chat Completions / Claude image item inside tool output.
function extractImageUrlFromPart(part) {
  if (!part || typeof part !== 'object') return null;
  if (part.type === 'input_image' || part.type === 'image_url') {
    if (typeof part.image_url === 'string' && part.image_url) {
      return part.image_url;
    }
    if (part.image_url && typeof part.image_url.url === 'string' && part.image_url.url) {
      return part.image_url.url;
    }
  }
  if (
    part.type === 'image' &&
    part.source &&
    part.source.type === 'base64' &&
    typeof part.source.data === 'string'
  ) {
    const mediaType = part.source.media_type || 'image/png';
    return `data:${mediaType};base64,${part.source.data}`;
  }
  return null;
}

// 9router stringifies non-text `function_call_output.output` items (such as
// Codex CLI's `view_image` `input_image` blocks) into raw base64 text inside
// `role: "tool"`, inflating each screenshot into ~600k text tokens instead of
// ~1k multimodal vision tokens. Lifting tool-output images into a following
// `role: "user"` message lets 9router translate them into native `inlineData`
// / `image_url` / `image` vision parts across all upstream providers.
function normalizeResponsesInput(input) {
  if (!Array.isArray(input)) return;
  const out = [];
  let pendingImages = [];

  const flushPendingImages = () => {
    if (pendingImages.length === 0) return;
    const content = [];
    for (const img of pendingImages) {
      content.push({
        type: 'input_text',
        text: `[Image from tool result ${img.callId}]`,
      });
      content.push({
        type: 'input_image',
        image_url: img.url,
        ...(img.detail ? { detail: img.detail } : {}),
      });
    }
    out.push({
      type: 'message',
      role: 'user',
      content,
    });
    pendingImages = [];
  };

  let changed = false;
  for (const item of input) {
    const isToolOutput =
      item &&
      typeof item === 'object' &&
      (item.type === 'function_call_output' ||
        item.type === 'custom_tool_call_output');

    if (!isToolOutput) {
      flushPendingImages();
      out.push(item);
      continue;
    }

    let rawOutput = item.output;
    if (
      typeof rawOutput === 'string' &&
      rawOutput.length > 64 &&
      (rawOutput.startsWith('[') || rawOutput.startsWith('{')) &&
      (rawOutput.includes('input_image') || rawOutput.includes('data:image/'))
    ) {
      try {
        const parsed = JSON.parse(rawOutput);
        rawOutput = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        // leave as string
      }
    }

    if (Array.isArray(rawOutput)) {
      const keptText = [];
      const extracted = [];
      for (const part of rawOutput) {
        const url = extractImageUrlFromPart(part);
        if (url) {
          extracted.push({
            callId: item.call_id || item.id || 'tool',
            url,
            detail: part && typeof part.detail === 'string' ? part.detail : undefined,
          });
        } else if (part && typeof part.text === 'string') {
          keptText.push(part.text);
        } else if (typeof part === 'string') {
          keptText.push(part);
        }
      }

      if (extracted.length > 0) {
        changed = true;
        pendingImages.push(...extracted);
        const callId = item.call_id || item.id || 'tool';
        const replacementText =
          keptText.join('\n').trim() ||
          `[Image from tool result ${callId} attached in user message]`;
        out.push({
          ...item,
          output: replacementText,
        });
        continue;
      }
    }

    out.push(item);
  }

  flushPendingImages();
  if (changed) {
    input.length = 0;
    input.push(...out);
  }
}

// Lift `{ type: "image" }` blocks out of Claude `tool_result.content` arrays
// into the enclosing `role: "user"` message's top-level `content` array so
// 9router's direct Claude->Antigravity translator doesn't `JSON.stringify`
// them as base64 text inside `functionResponse`.
function normalizeClaudeMessages(messages) {
  if (!Array.isArray(messages)) return;
  for (const msg of messages) {
    if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) continue;
    const lifted = [];
    let changed = false;
    const nextContent = msg.content.map((block) => {
      if (
        !block ||
        block.type !== 'tool_result' ||
        !Array.isArray(block.content)
      ) {
        return block;
      }
      const images = block.content.filter((c) => c && c.type === 'image');
      if (images.length === 0) return block;
      changed = true;
      const rest = block.content.filter((c) => !c || c.type !== 'image');
      lifted.push(
        {
          type: 'text',
          text: `[Image from tool result ${block.tool_use_id || 'tool'}]`,
        },
        ...images
      );
      return {
        ...block,
        content:
          rest.length > 0
            ? rest
            : [{ type: 'text', text: '(image attached below)' }],
      };
    });
    if (changed) {
      msg.content = [...nextContent, ...lifted];
    }
  }
}

// Patch 9router's direct Antigravity-Claude translator in chunk 1297.js so
// top-level `k.R4.IMAGE` blocks in `f.content` become Gemini `inlineData`
// parts instead of being ignored.
function patchAntigravityClaudeImageSupport(appRoot) {
  try {
    const chunkPath = path.join(
      appRoot,
      '.next-cli-build',
      'server',
      'chunks',
      '1297.js'
    );
    if (!fs.existsSync(chunkPath)) return;
    const src = fs.readFileSync(chunkPath, 'utf8');
    const target =
      'for(let j of f.content)if(j.type===k.R4.TEXT)b.push({text:j.text});else if(j.type===k.R4.TOOL_USE)';
    const replacement =
      'for(let j of f.content)if(j.type===k.R4.TEXT)b.push({text:j.text});else if(j.type===k.R4.IMAGE&&j.source?.data)b.push({inlineData:{mimeType:j.source.media_type||"image/png",data:j.source.data}});else if(j.type===k.R4.TOOL_USE)';
    if (src.includes(target) && !src.includes(replacement)) {
      fs.writeFileSync(chunkPath, src.replace(target, replacement), 'utf8');
      console.log('[hivedeck] patched 1297.js for Antigravity Claude image support');
    }
  } catch (err) {
    console.error(
      `[hivedeck] 1297.js image patch skipped: ${err && err.message}`
    );
  }
}

patchAntigravityClaudeImageSupport(appDir);

if (
  typeof globalThis.Request === 'function' &&
  globalThis.Request.prototype &&
  typeof globalThis.Request.prototype.json === 'function'
) {
  const origJson = globalThis.Request.prototype.json;
  globalThis.Request.prototype.json = async function patchedRequestJson(
    ...args
  ) {
    const body = await origJson.apply(this, args);
    if (body && typeof body === 'object') {
      try {
        if (Array.isArray(body.input)) {
          normalizeResponsesInput(body.input);
        }
        if (Array.isArray(body.messages)) {
          normalizeClaudeMessages(body.messages);
        }
      } catch (err) {
        console.error(
          `[hivedeck] tool-output image normalization error: ${err && err.message}`
        );
      }
    }
    return body;
  };
}

console.log(
  `[hivedeck] starting 9router from ${pkgDir} on ${process.env.HOSTNAME}:${process.env.PORT}`
);
process.chdir(appDir);
// custom-server.js wraps http.createServer (real client IP, h2c downgrade)
// but only boots the server itself when it is the main module, so load it
// for its side effects and then boot the standalone server explicitly.
if (fs.existsSync(customServer)) require(customServer);
require(standaloneServer);
