/**
 * Production launcher — starts both the API server and Discord bot in parallel.
 * The API server handles all HTTP traffic (API routes + static dashboard files).
 * The Discord bot runs alongside it for 24/7 uptime.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsx = path.join(__dirname, "node_modules/.bin/tsx");

function startProcess(name, command, args, env = {}) {
  const proc = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    cwd: __dirname,
  });

  proc.on("error", (err) => {
    console.error(`[${name}] Failed to start:`, err.message);
  });

  proc.on("exit", (code, signal) => {
    const reason = signal ?? code;
    console.error(`[${name}] Exited (${reason}). Restarting in 5s...`);
    setTimeout(() => startProcess(name, command, args, env), 5_000);
  });

  console.log(`[${name}] Started (pid=${proc.pid})`);
  return proc;
}

console.log("=== Production Services Starting ===");

startProcess(
  "API Server",
  "node",
  ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"],
  { NODE_ENV: "production", PORT: process.env.PORT ?? "8080" }
);

startProcess(
  "Discord Bot",
  tsx,
  ["artifacts/discord-bot/src/index.ts"],
  { NODE_ENV: "production" }
);
