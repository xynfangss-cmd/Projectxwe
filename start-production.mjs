/**
 * Production launcher.
 * Replit runs this script once per artifact:
 *   - PORT=8080  → api-server artifact  → starts API server + Discord bot
 *   - PORT=25712 → bot-dashboard artifact → starts a lightweight static file server
 *
 * This ensures the Discord bot starts exactly ONCE, preventing session conflicts.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsx = path.join(__dirname, "node_modules/.bin/tsx");
const PORT = process.env.PORT ?? "8080";

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

if (PORT === "8080") {
  // API server artifact — start API server and the Discord bot
  console.log("=== API Server + Discord Bot Starting ===");

  startProcess(
    "API Server",
    "node",
    ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"],
    { NODE_ENV: "production", PORT: "8080" }
  );

  startProcess(
    "Discord Bot",
    tsx,
    ["artifacts/discord-bot/src/index.ts"],
    { NODE_ENV: "production" }
  );
} else {
  // bot-dashboard artifact — serve static dashboard files on its assigned port
  console.log(`=== Dashboard Static Server Starting on port ${PORT} ===`);

  const staticDir = path.join(__dirname, "artifacts/bot-dashboard/dist/public");

  const server = http.createServer((req, res) => {
    let filePath = path.join(staticDir, req.url === "/" ? "index.html" : req.url);

    // Strip query strings
    filePath = filePath.split("?")[0];

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(staticDir, "index.html");
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      ".html": "text/html",
      ".js":   "application/javascript",
      ".css":  "text/css",
      ".png":  "image/png",
      ".jpg":  "image/jpeg",
      ".svg":  "image/svg+xml",
      ".json": "application/json",
      ".ico":  "image/x-icon",
    };

    res.writeHead(200, { "Content-Type": mimeTypes[ext] ?? "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });

  server.listen(Number(PORT), () => {
    console.log(`[Dashboard] Serving static files on port ${PORT}`);
  });
}
