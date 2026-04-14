/**
 * Nuclear reset script — run with: pnpm --filter @workspace/discord-bot run deploy-commands
 * 1. Wipes ALL global application commands (removes duplicates)
 * 2. Registers all 31 commands directly to the guild (instant, no propagation wait)
 */
import { REST, Routes } from "discord.js";

import * as rank from "./commands/rank.js";
import * as leaderboard from "./commands/leaderboard.js";
import * as chest from "./commands/chest.js";
import * as daily from "./commands/daily.js";
import * as weekly from "./commands/weekly.js";
import * as work from "./commands/work.js";
import * as crime from "./commands/crime.js";
import * as balance from "./commands/balance.js";
import * as bank from "./commands/bank.js";
import * as transfer from "./commands/transfer.js";
import * as gamble from "./commands/gamble.js";
import * as giveaway from "./commands/giveaway.js";
import * as shop from "./commands/shop.js";
import * as admin from "./commands/admin.js";
import * as ranks from "./commands/ranks.js";
import * as help from "./commands/help.js";
import * as blackjack from "./commands/blackjack.js";
import * as mines from "./commands/mines.js";
import * as setupverify from "./commands/setupverify.js";
import * as tickets from "./commands/tickets.js";
import * as setchest from "./commands/setchest.js";
import * as setupboostergiveaway from "./commands/setupboostergiveaway.js";
import * as startboostergiveaway from "./commands/startboostergiveaway.js";
import * as createcode from "./commands/createcode.js";
import * as activecodes from "./commands/activecodes.js";
import * as redeem from "./commands/redeem.js";
import * as bjduel from "./commands/bjduel.js";
import * as gift from "./commands/gift.js";
import * as givegems from "./commands/givegems.js";
import * as stocks from "./commands/stocks.js";
import * as giverole from "./commands/giverole.js";

const allCommands = [
  rank, leaderboard, chest, daily, weekly, work, crime, balance,
  bank, transfer, gamble, giveaway, shop, admin, ranks, help,
  blackjack, mines, setupverify, tickets, setchest, setupboostergiveaway, startboostergiveaway,
  createcode, activecodes, redeem, bjduel, gift, givegems, stocks, giverole,
];

const token    = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId  = "1435464842738925641";

if (!token || !clientId) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set!");
}

const rest = new REST({ version: "10" }).setToken(token);
const commandsJSON = allCommands.map((cmd) => cmd.data.toJSON());

async function reset() {
  console.log("🧹 Step 1: Wiping all global application commands…");
  await rest.put(Routes.applicationCommands(clientId!), { body: [] });
  console.log("✅ Global commands cleared.");

  console.log(`\n📡 Step 2: Registering ${commandsJSON.length} commands to guild ${guildId}…`);
  await rest.put(Routes.applicationGuildCommands(clientId!, guildId), { body: commandsJSON });
  console.log(`✅ Done! Commands: ${commandsJSON.map((c) => c.name).join(", ")}`);
}

reset().catch((err) => {
  console.error("❌ Reset failed:", err);
  process.exit(1);
});
