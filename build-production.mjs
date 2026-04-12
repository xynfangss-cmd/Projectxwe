/**
 * Production build script — builds both the bot dashboard (React/Vite)
 * and the API server (esbuild) for deployment.
 */
import { execSync } from "node:child_process";

function run(label, cmd) {
  console.log(`\n=== Building: ${label} ===`);
  execSync(cmd, { stdio: "inherit" });
  console.log(`=== Done: ${label} ===\n`);
}

run("Bot Dashboard (React/Vite)", "pnpm --filter @workspace/bot-dashboard run build");
run("API Server (esbuild)", "pnpm --filter @workspace/api-server run build");

console.log("All production builds complete.");
