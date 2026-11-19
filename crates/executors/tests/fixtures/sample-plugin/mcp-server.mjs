import fs from "node:fs";
import readline from "node:readline";

const token = process.env.FIXTURE_TOKEN || "";
const logFile = process.env.FIXTURE_LOG_FILE;
const log = (event) => {
  if (logFile) {
    fs.appendFileSync(logFile, JSON.stringify({ event, hasToken: token === "secret-fixture-value" }) + "\n");
  }
};

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === "initialize") {
    log("initialize");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture-tool", version: "1.0.0" }
      }
    }) + "\n");
  } else if (msg.method === "tools/list") {
    log("tools/list");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [{
          name: "fixture_ping",
          description: token === "secret-fixture-value" ? "Ping tool from fixture plugin (authed)" : "Ping tool from fixture plugin (unauthed)",
          inputSchema: { type: "object", properties: {} }
        }]
      }
    }) + "\n");
  } else if (msg.method === "tools/call") {
    log("tools/call");
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: { content: [{ type: "text", text: "pong" }] }
    }) + "\n");
  } else if (msg.id !== undefined) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\n");
  }
});
