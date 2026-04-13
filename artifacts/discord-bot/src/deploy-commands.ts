import { REST, Routes } from "discord.js";

// Import all command data
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

const allCommands = [
  rank, leaderboard, chest, daily, weekly, work, crime, balance,
  bank, transfer, gamble, giveaway, shop, admin, ranks, help,
  blackjack, mines, setupverify, tickets, setchest,
];
const commandsJSON = allCommands.map((cmd) => cmd.data.toJSON());

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set!");
}

const rest = new REST({ version: "10" }).setToken(token);
const resolvedClientId: string = clientId;

async function deploy() {
  console.log(`🚀 Deploying ${commandsJSON.length} global slash commands...`);
  try {
    const data = await rest.put(Routes.applicationCommands(resolvedClientId), { body: commandsJSON }) as unknown[];
    console.log(`✅ Successfully registered ${data.length} commands globally.`);
    console.log("Commands:", commandsJSON.map((c) => c.name).join(", "));
  } catch (err) {
    console.error("Failed to deploy commands:", err);
    process.exit(1);
  }
}

deploy();
