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
  GuildMember,
  Role,
  REST,
  Routes,
} from "discord.js";
import { handleMessage } from "./systems/messageXP.js";
import { startGiveawayManager } from "./systems/giveawayManager.js";
import {
  startInviteTracker,
  cacheGuildInvites,
  detectInviter,
  pendingInviters,
} from "./systems/inviteTracker.js";
import {
  getOrCreateUser,
  updateUser,
  getOrCreateBankAccount,
  getGiveaway,
  updateGiveaway,
  logChestReward,
} from "./utils/db.js";
import {
  formatNumber,
  CHEST_COST_XP,
  CHEST_REWARDS,
  weightedRandom,
} from "./utils/constants.js";

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
import { startBoosterGiveaway, activeRounds, handleBoosterEntry } from "./systems/boosterGiveaway.js";
import { startAutoGiveaway, handleAutoGawEntry } from "./systems/autoGiveaway.js";

type Command = {
  data: { name: string; toJSON: () => unknown };
  execute: (interaction: Parameters<typeof rank.execute>[0]) => Promise<unknown>;
};

const commands = new Collection<string, Command>();
const allCommands = [
  rank, leaderboard, chest, daily, weekly, work, crime, balance,
  bank, transfer, gamble, giveaway, shop, admin, ranks, help,
  blackjack, mines, setupverify, tickets, setchest, setupboostergiveaway, startboostergiveaway,
  createcode, activecodes, redeem, bjduel, gift, givegems, stocks, giverole,
];
for (const cmd of allCommands) {
  commands.set(cmd.data.name, cmd as Command);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
});

// Prevent unhandled errors from crashing the process
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

  // Register commands to each guild instantly (guild commands propagate immediately)
  const commandsJSON = allCommands.map((cmd) => cmd.data.toJSON());
  const rest = new REST({ version: "10" }).setToken(token!);
  for (const [guildId] of c.guilds.cache) {
    try {
      await rest.put(Routes.applicationGuildCommands(clientId!, guildId), { body: commandsJSON });
      console.log(`✅ Guild commands registered for ${guildId}`);
    } catch (err) {
      console.error(`⚠️ Failed to register guild commands for ${guildId}:`, (err as Error).message);
    }
  }

  startGiveawayManager(client);
  startInviteTracker(client);
  startBoosterGiveaway(client);
  startAutoGiveaway(client);

  // Cache invites for all guilds
  for (const [, guild] of c.guilds.cache) {
    await cacheGuildInvites(guild);
  }
  console.log("📋 Invite cache loaded");
});

// ── New member joins ──────────────────────────────────────────────────────────
client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
  try {
    const guild = member.guild;

    // Detect which invite was used
    const inviterId = await detectInviter(guild);
    if (inviterId && inviterId !== member.id) {
      pendingInviters.set(member.id, inviterId);
      console.log(`📨 ${member.user.username} was invited by ${inviterId}`);
    }

    // Find the Unverified role and assign it
    const unverifiedRole = guild.roles.cache.find(
      (r: Role) => r.name.toLowerCase() === "unverified"
    );
    if (unverifiedRole) {
      await member.roles.add(unverifiedRole, "New member — pending verification").catch(() => {});
    }

    // Send a welcome prompt in the #verify channel
    const verifyChannel = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === "verify"
    ) as TextChannel | undefined;

    if (verifyChannel) {
      await verifyChannel.send({
        content: `👋 Welcome ${member}! Click **Verify** above to gain access to the server.`,
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[GuildMemberAdd Error]", err);
  }
});

client.on(Events.MessageCreate, async (message) => {
  await handleMessage(client, message).catch((err) => {
    console.error("Error handling message:", err);
  });
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  // Drop stale interactions replayed after a bot restart (already past Discord's 3s window)
  if ("createdTimestamp" in interaction && Date.now() - (interaction as any).createdTimestamp > 2900) return;

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
      if (err?.code === 10062) return; // Unknown interaction — stale, drop silently
      console.error("[Button Error]", err?.message ?? err);
    });
  }
});

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const { customId, user, guildId } = interaction;

  // ── Route blackjack buttons ──────────────────────────────────────────────
  if (customId.startsWith("bj_")) {
    await blackjack.handleButton(interaction);
    return;
  }

  // ── Route blackjack duel buttons ─────────────────────────────────────────
  if (customId.startsWith("bjduel_")) {
    await bjduel.handleDuelButton(interaction);
    return;
  }

  // ── Route mines buttons ──────────────────────────────────────────────────
  if (customId.startsWith("mines_")) {
    await mines.handleButton(interaction);
    return;
  }

  // ── Route stocks buttons ──────────────────────────────────────────────────
  if (customId.startsWith("stocks_")) {
    await stocks.handleButton(interaction);
    return;
  }

  // ── Verify button ─────────────────────────────────────────────────────────
  if (customId === "verify_member") {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch {
      return; // stale or already-responded interaction — drop silently
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({ content: "This can only be used in a server." });
      return;
    }

    const member = interaction.member as GuildMember;

    // Find the Unverified and Verified roles
    const unverifiedRole = guild.roles.cache.find(
      (r: Role) => r.name.toLowerCase() === "unverified"
    );
    const verifiedRole = guild.roles.cache.find(
      (r: Role) => r.name.toLowerCase() === "verified"
    );

    if (!unverifiedRole || !verifiedRole) {
      await interaction.editReply({ content: "⚠️ Verification system is not fully set up. Ask an admin to run `/setupverify`." });
      return;
    }

    // Already has the verified role
    if (member.roles.cache.has(verifiedRole.id)) {
      await interaction.editReply({ content: "✅ You are already verified!" });
      return;
    }

    // Swap roles: remove Unverified, add Verified — opens the whole server
    await Promise.all([
      member.roles.remove(unverifiedRole, "Member verified").catch(() => {}),
      member.roles.add(verifiedRole, "Member verified").catch(() => {}),
    ]);

    // Give 100M gems to the new member
    const INVITE_REWARD = 100_000_000;
    const dbUser = await getOrCreateUser(user.id, guildId!, user.username);
    await updateUser(user.id, guildId!, { credits: dbUser.credits + INVITE_REWARD });

    // Give 100M gems to the inviter (if tracked)
    const inviterId = pendingInviters.get(user.id);
    pendingInviters.delete(user.id);

    if (inviterId) {
      const inviterUser = await getOrCreateUser(inviterId, guildId!, "");
      await updateUser(inviterId, guildId!, { credits: inviterUser.credits + INVITE_REWARD });
    }

    await interaction.editReply({
      content: [
        `✅ **You're now verified!** Welcome to the server!`,
        `💎 You've received **${formatNumber(INVITE_REWARD)} gems** as a welcome gift!`,
        inviterId ? `🎉 <@${inviterId}> also received **${formatNumber(INVITE_REWARD)} gems** for inviting you!` : "",
      ].filter(Boolean).join("\n"),
    });
    return;
  }

  // ── Ticket buttons ────────────────────────────────────────────────────────
  if (
    customId === "ticket_staff_report" ||
    customId === "ticket_scam_report" ||
    customId === "ticket_general_help"
  ) {
    try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({ content: "This can only be used in a server." });
      return;
    }

    const typeMap: Record<string, { label: string; emoji: string; color: number; desc: string }> = {
      ticket_staff_report: {
        label: "Staff Report",
        emoji: "🛡️",
        color: 0xed4245,
        desc: "Please describe the staff member you are reporting and what happened. Include any evidence (screenshots, timestamps) if you have them.",
      },
      ticket_scam_report: {
        label: "Scam Report",
        emoji: "🚨",
        color: 0xfee75c,
        desc: "Please describe the scam or suspicious activity. Include the user involved, what happened, and any evidence you have.",
      },
      ticket_general_help: {
        label: "General Help",
        emoji: "❓",
        color: 0x5865f2,
        desc: "Please describe your question or issue and our staff will assist you as soon as possible.",
      },
    };

    const info = typeMap[customId];
    const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18);
    const ticketTypeSlug = customId.replace("ticket_", "").replace("_", "-");
    const ticketName = `${ticketTypeSlug}-${safeName}`;

    // Check for duplicate open ticket of same type
    const existing = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === ticketName
    );
    if (existing) {
      await interaction.editReply({ content: `You already have an open ticket: <#${existing.id}>` });
      return;
    }

    // Find Tickets category if it exists
    const category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === "tickets"
    );

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
      topic: `${info.label} ticket for ${user.username}`,
    });

    const ticketEmbed = new EmbedBuilder()
      .setColor(info.color)
      .setTitle(`${info.emoji} ${info.label} — Ticket`)
      .setDescription(
        `Hello ${user}! 👋\n\nStaff will be with you shortly.\n\n**Instructions:**\n${info.desc}`
      )
      .addFields({ name: "Opened by", value: `${user} (${user.username})`, inline: true })
      .setFooter({ text: "Click Close Ticket when your issue is resolved" })
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
      content: `✅ Your **${info.label}** ticket has been opened: <#${ticketChannel.id}>`,
    });
    return;
  }

  // ── Booster giveaway enter button ────────────────────────────────────────
  if (customId.startsWith("bgaw_enter_")) {
    try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }
    const roundId = customId.replace("bgaw_enter_", "");
    const result  = await handleBoosterEntry(client, roundId, user.id, guildId!);
    await interaction.editReply({ content: result });
    return;
  }

  // ── Auto giveaway enter button ────────────────────────────────────────────
  if (customId.startsWith("autogaw_enter_")) {
    try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }
    const roundId = customId.replace("autogaw_enter_", "");
    const result  = await handleAutoGawEntry(roundId, user.id);
    await interaction.editReply({ content: result });
    return;
  }

  // ── Chest panel button ───────────────────────────────────────────────────
  if (customId === "chest_open") {
    try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }

    const dbUser = await getOrCreateUser(user.id, guildId!, user.username);

    if (dbUser.xp < CHEST_COST_XP) {
      const needed = CHEST_COST_XP - dbUser.xp;
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("❌ Not Enough XP")
            .setDescription(
              `You need **${CHEST_COST_XP} XP** to open a chest.\n` +
              `You have **${formatNumber(dbUser.xp)} XP** — you need **${formatNumber(needed)}** more.\n\n` +
              `💬 Earn XP by chatting — every 10,000 gems gives you 100 XP!`
            )
            .setTimestamp(),
        ],
      });
      return;
    }

    const reward = weightedRandom(CHEST_REWARDS);
    const creditsWon =
      reward.minCredits > 0
        ? Math.floor(Math.random() * (reward.maxCredits - reward.minCredits + 1)) + reward.minCredits
        : 0;
    const xpWon = reward.xp ?? 0;

    const newXp      = dbUser.xp - CHEST_COST_XP + xpWon;
    const newCredits = dbUser.credits + creditsWon;

    await updateUser(user.id, guildId!, { xp: newXp, credits: newCredits });
    await logChestReward(user.id, guildId!, reward.type, creditsWon || xpWon, CHEST_COST_XP);

    const rewardDesc =
      creditsWon > 0
        ? `**+${formatNumber(creditsWon)} gems** 💎`
        : `**+${formatNumber(xpWon)} XP** ⭐`;

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xffd700)
          .setTitle(`${reward.emoji} ${reward.type}!`)
          .setDescription(`You cracked open the mystery chest and won:\n\n${rewardDesc}`)
          .addFields(
            { name: "💰 Gems", value: formatNumber(newCredits), inline: true },
            { name: "🌟 XP Remaining", value: formatNumber(newXp), inline: true },
          )
          .setFooter({ text: `Spent ${CHEST_COST_XP} XP · Open another when you have enough!` })
          .setTimestamp(),
      ],
    });
    return;
  }

  // ── Bank: Balance button ─────────────────────────────────────────────────
  if (customId === "bank_balance") {
    try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }
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

  // ── Bank: Deposit (open ticket) button ───────────────────────────────────
  if (customId === "bank_deposit") {
    try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }
    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({ content: "This can only be used inside a server." });
      return;
    }

    const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
    const ticketName = `deposit-${safeName}`;

    const existing = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === ticketName
    );
    if (existing) {
      await interaction.editReply({
        content: `You already have an open deposit ticket: <#${existing.id}>`,
      });
      return;
    }

    const category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === "tickets"
    );

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

  // ── Close ticket button ──────────────────────────────────────────────────
  if (customId === "close_ticket") {
    const channel = interaction.channel as TextChannel;
    const isTicketChannel =
      channel?.name?.startsWith("deposit-") ||
      channel?.name?.startsWith("staff-report-") ||
      channel?.name?.startsWith("scam-report-") ||
      channel?.name?.startsWith("general-help-");

    if (!isTicketChannel) {
      await interaction.reply({ content: "This button can only be used inside a ticket channel.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ content: "🔒 Closing ticket in 5 seconds..." });
    setTimeout(() => channel.delete("Ticket closed").catch(() => {}), 5_000);
    return;
  }

  // ── Giveaway entry buttons: giveaway_enter_<id> ──────────────────────────
  if (customId.startsWith("giveaway_enter_")) {
    try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }
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

const token    = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set!");
}

// Clear all global commands so they don't duplicate guild-specific ones
async function clearGlobalCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token!);
  try {
    await rest.put(Routes.applicationCommands(clientId!), { body: [] });
    console.log("🧹 Global commands cleared.");
  } catch (err) {
    console.error("⚠️ Failed to clear global commands (non-fatal):", (err as Error).message);
  }
}

clearGlobalCommands().then(() => {
  client.login(token).catch((err) => {
    console.error("Failed to log in:", err);
    process.exit(1);
  });
});
