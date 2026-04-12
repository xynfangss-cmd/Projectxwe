import {
  Client,
  GatewayIntentBits,
  Collection,
  Interaction,
  ComponentType,
  ButtonInteraction,
  Events,
  ActivityType,
} from "discord.js";
import { handleMessage } from "./systems/messageXP.js";
import { startGiveawayManager } from "./systems/giveawayManager.js";
import {
  getOrCreateUser,
  updateUser,
  getOrCreateBankAccount,
  updateBankAccount,
  getGiveaway,
  updateGiveaway,
} from "./utils/db.js";
import { formatNumber } from "./utils/constants.js";

// Import all commands
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

type Command = {
  data: { name: string; toJSON: () => unknown };
  execute: (interaction: Parameters<typeof rank.execute>[0]) => Promise<unknown>;
};

const commands = new Collection<string, Command>();
const allCommands = [rank, leaderboard, chest, daily, weekly, work, crime, balance, bank, transfer, gamble, giveaway, shop, admin, ranks, help];
for (const cmd of allCommands) {
  commands.set(cmd.data.name, cmd as Command);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`📊 Serving ${c.guilds.cache.size} guild(s)`);

  c.user.setPresence({
    activities: [{ name: "/help | Earn credits by chatting!", type: ActivityType.Playing }],
    status: "online",
  });

  startGiveawayManager(client);
});

client.on(Events.MessageCreate, async (message) => {
  await handleMessage(client, message).catch((err) => {
    console.error("Error handling message:", err);
  });
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Error in command ${interaction.commandName}:`, err);
      const msg = { content: "An error occurred while running this command.", ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    }
    return;
  }

  // Handle button interactions
  if (interaction.isButton()) {
    await handleButton(interaction);
  }
});

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const { customId, user, guildId } = interaction;

  // Giveaway entry buttons: giveaway_enter_<id>
  if (customId.startsWith("giveaway_enter_")) {
    await interaction.deferReply({ ephemeral: true });
    const id = parseInt(customId.replace("giveaway_enter_", ""));
    const gaw = await getGiveaway(id);

    if (!gaw || !gaw.isActive) {
      await interaction.editReply({ content: "This giveaway has ended." });
    }

    const entrants = (gaw.entrantsJson as string[]) ?? [];

    if (entrants.includes(user.id)) {
      await interaction.editReply({ content: "You are already entered in this giveaway!" });
    }

    // Handle entry cost
    if (gaw.entryCost > 0) {
      const dbUser = await getOrCreateUser(user.id, guildId!, user.username);
      if (dbUser.credits < gaw.entryCost) {
        await interaction.editReply({ content: `You need **${formatNumber(gaw.entryCost)}** credits to enter. You have **${formatNumber(dbUser.credits)}**.` });
      }
      await updateUser(user.id, guildId!, { credits: dbUser.credits - gaw.entryCost });
    }

    entrants.push(user.id);
    await updateGiveaway(id, { entrantsJson: entrants });

    await interaction.editReply({
      content: `You've entered the giveaway for **${gaw.prize}**! ${gaw.entryCost > 0 ? `(${formatNumber(gaw.entryCost)} credits deducted)` : ""} Good luck! 🎉`,
    });
  }
}

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN environment variable is not set!");
}

client.login(token).catch((err) => {
  console.error("Failed to log in:", err);
  process.exit(1);
});
