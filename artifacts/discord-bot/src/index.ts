import {
  Client,
  GatewayIntentBits,
  Collection,
  Interaction,
  ButtonInteraction,
  Events,
  ActivityType,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  MessageFlags,
} from "discord.js";
import { handleMessage } from "./systems/messageXP.js";
import { startGiveawayManager } from "./systems/giveawayManager.js";
import {
  getOrCreateUser,
  updateUser,
  getOrCreateBankAccount,
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

// Prevent unhandled promise rejections from crashing the process
client.on("error", (err) => {
  console.error("[Client Error]", err.message);
});

process.on("unhandledRejection", (err) => {
  console.error("[Unhandled Rejection]", err);
});

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`📊 Serving ${c.guilds.cache.size} guild(s)`);

  c.user.setPresence({
    activities: [{ name: "/help | Earn gems by chatting!", type: ActivityType.Playing }],
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
      const msg = { content: "An error occurred while running this command.", flags: MessageFlags.Ephemeral };
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
    await handleButton(interaction).catch((err) => {
      console.error("[Button Error]", err?.message ?? err);
    });
  }
});

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const { customId, user, guildId } = interaction;

  // ── Bank: Balance button ────────────────────────────────────────────────
  if (customId === "bank_balance") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [dbUser, bankAccount] = await Promise.all([
      getOrCreateUser(user.id, guildId!, user.username),
      getOrCreateBankAccount(user.id, guildId!),
    ]);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("💰 Your Balance")
      .addFields(
        { name: "💰 Wallet", value: `${formatNumber(dbUser.credits)} gems`, inline: true },
        { name: "🏦 Bank", value: `${formatNumber(bankAccount.balance)} gems`, inline: true },
        { name: "📊 Total", value: `${formatNumber(dbUser.credits + bankAccount.balance)} gems`, inline: true },
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── Bank: Deposit (open ticket) button ──────────────────────────────────
  if (customId === "bank_deposit") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({ content: "This can only be used inside a server." });
      return;
    }

    const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
    const ticketName = `deposit-${safeName}`;

    // Check for existing open ticket
    const existing = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === ticketName
    );
    if (existing) {
      await interaction.editReply({
        content: `You already have an open deposit ticket: <#${existing.id}>`,
      });
      return;
    }

    // Find a "Tickets" category if one exists
    const category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === "tickets"
    );

    // Create the private ticket channel
    const ticketChannel = await guild.channels.create({
      name: ticketName,
      type: ChannelType.GuildText,
      parent: category?.id ?? null,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
      topic: `Deposit ticket for ${user.username}`,
    });

    const ticketEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("📬 Deposit Ticket")
      .setDescription(
        `Hello ${user}! 👋\n\nAn admin will assist you with your deposit shortly.\n\nPlease let us know **how much** you would like to deposit and we'll get it sorted.`
      )
      .setFooter({ text: "Click Close Ticket when you are done" })
      .setTimestamp();

    const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("Close Ticket")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({
      content: `${user}`,
      embeds: [ticketEmbed],
      components: [closeRow],
    });

    await interaction.editReply({
      content: `✅ Your deposit ticket has been opened: <#${ticketChannel.id}>`,
    });
    return;
  }

  // ── Close ticket button ─────────────────────────────────────────────────
  if (customId === "close_ticket") {
    const channel = interaction.channel as TextChannel;
    if (!channel?.name?.startsWith("deposit-")) {
      await interaction.reply({ content: "This button can only be used in a deposit ticket.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ content: "🔒 Closing ticket in 5 seconds..." });
    setTimeout(() => channel.delete("Ticket closed").catch(() => {}), 5_000);
    return;
  }

  // ── Giveaway entry buttons: giveaway_enter_<id> ─────────────────────────
  if (customId.startsWith("giveaway_enter_")) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const id = parseInt(customId.replace("giveaway_enter_", ""));
    const gaw = await getGiveaway(id);

    if (!gaw || !gaw.isActive) {
      await interaction.editReply({ content: "This giveaway has already ended." });
      return;
    }

    const entrants = (gaw.entrantsJson as string[]) ?? [];

    if (entrants.includes(user.id)) {
      await interaction.editReply({ content: "You are already entered in this giveaway!" });
      return;
    }

    // Handle entry cost
    if (gaw.entryCost > 0) {
      const dbUser = await getOrCreateUser(user.id, guildId!, user.username);
      if (dbUser.credits < gaw.entryCost) {
        await interaction.editReply({
          content: `You need **${formatNumber(gaw.entryCost)}** gems to enter. You only have **${formatNumber(dbUser.credits)}**.`,
        });
        return;
      }
      await updateUser(user.id, guildId!, { credits: dbUser.credits - gaw.entryCost });
    }

    entrants.push(user.id);
    await updateGiveaway(id, { entrantsJson: entrants });

    await interaction.editReply({
      content: `🎉 You've entered the giveaway for **${gaw.prize}**!${gaw.entryCost > 0 ? ` (${formatNumber(gaw.entryCost)} gems deducted)` : ""} Good luck!`,
    });
    return;
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
