import {
  Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  GuildMember,
  Role,
} from "discord.js";
import { getOrCreateGuildSettings, getOrCreateUser, updateUser } from "../utils/db.js";
import { formatNumber } from "../utils/constants.js";

const PRIZE_TOTAL      = 100_000_000;
const WINNER_COUNT     = 2;
const PRIZE_PER_WINNER = PRIZE_TOTAL / WINNER_COUNT; // 50M each
const GIVEAWAY_DURATION_MS = 45 * 60 * 1000;         // 45 minutes
const CYCLE_INTERVAL_MS    = 2 * 60 * 60 * 1000;     // every 2 hours

// Active giveaway state per round
export interface BoosterRound {
  roundId: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  entrants: Set<string>;
  endsAt: number;
  ended: boolean;
}

// roundId → round state
export const activeRounds = new Map<string, BoosterRound>();

function makeRoundId(): string {
  return `bgaw_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
}

function timeLeft(endsAt: number): string {
  const ms = endsAt - Date.now();
  if (ms <= 0) return "Ended";
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function postGiveaway(client: Client, guildId: string, channelId: string): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
  if (!channel) return;

  const roundId = makeRoundId();
  const endsAt  = Date.now() + GIVEAWAY_DURATION_MS;

  const embed = buildEmbed(0, endsAt);
  const row   = buildRow(roundId);

  const msg = await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
  if (!msg) return;

  const round: BoosterRound = {
    roundId,
    guildId,
    channelId,
    messageId: msg.id,
    entrants: new Set(),
    endsAt,
    ended: false,
  };
  activeRounds.set(roundId, round);

  // Schedule giveaway end
  setTimeout(() => endGiveaway(client, roundId), GIVEAWAY_DURATION_MS);
}

async function endGiveaway(client: Client, roundId: string): Promise<void> {
  const round = activeRounds.get(roundId);
  if (!round || round.ended) return;
  round.ended = true;

  const guild = client.guilds.cache.get(round.guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(round.channelId) as TextChannel | undefined;
  if (!channel) return;

  // Filter entrants: must still be in server and have the booster role
  const boosterRole = guild.roles.premiumSubscriberRole;
  const eligibleEntrants: string[] = [];

  for (const userId of round.entrants) {
    const member = guild.members.cache.get(userId) ??
      await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    if (!boosterRole || member.roles.cache.has(boosterRole.id)) {
      eligibleEntrants.push(userId);
    }
  }

  // Pick up to 2 random winners
  const shuffled  = eligibleEntrants.sort(() => Math.random() - 0.5);
  const winners   = shuffled.slice(0, WINNER_COUNT);
  const winnerCount = winners.length;

  // Award gems to each winner
  for (const winnerId of winners) {
    const dbUser = await getOrCreateUser(winnerId, round.guildId, "").catch(() => null);
    if (dbUser) {
      await updateUser(winnerId, round.guildId, {
        credits: dbUser.credits + PRIZE_PER_WINNER,
      }).catch(() => {});
    }
  }

  // Build result embed
  let resultDesc: string;
  if (winners.length === 0) {
    resultDesc = "No eligible server boosters entered this giveaway.";
  } else if (winners.length === 1) {
    resultDesc = `🎉 ${`<@${winners[0]}>`} won the full **${formatNumber(PRIZE_TOTAL)} gems**!`;
  } else {
    resultDesc = winners
      .map((w) => `🎉 <@${w}> — **+${formatNumber(PRIZE_PER_WINNER)} gems**`)
      .join("\n");
  }

  const endEmbed = new EmbedBuilder()
    .setColor(winners.length > 0 ? 0xffd700 : 0x99aab5)
    .setTitle("🎁 Booster Giveaway — Ended!")
    .setDescription(
      [
        winners.length > 0
          ? `The **${formatNumber(PRIZE_TOTAL)} gem** prize has been split between ${winnerCount} winner${winnerCount !== 1 ? "s" : ""}!`
          : "This giveaway ended with no winners.",
        "",
        resultDesc,
        "",
        `**Total entries:** ${round.entrants.size}`,
      ].join("\n")
    )
    .setFooter({ text: "Next booster giveaway in ~2 hours" })
    .setTimestamp();

  // Edit original message
  if (round.messageId) {
    await channel.messages.fetch(round.messageId)
      .then((m) => m.edit({ embeds: [endEmbed], components: [] }))
      .catch(() => {});
  }

  // Ping winners
  if (winners.length > 0) {
    await channel.send({
      content: `🎉 Congratulations ${winners.map((w) => `<@${w}>`).join(" and ")}! You each won **${formatNumber(PRIZE_PER_WINNER)} gems** from the Booster Giveaway!`,
    }).catch(() => {});
  }

  activeRounds.delete(roundId);
}

function buildEmbed(entries: number, endsAt: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf47fff)
    .setTitle("💜 Server Booster Giveaway!")
    .setDescription(
      [
        `A **${formatNumber(PRIZE_TOTAL)} gem** prize is up for grabs — split equally between **${WINNER_COUNT} winners** (${formatNumber(PRIZE_PER_WINNER)} gems each)!`,
        "",
        "**Requirements:**",
        "• Must be a 💜 **Server Booster**",
        "",
        `**⏰ Ends in:** ${timeLeft(endsAt)}`,
        `**👥 Entries:** ${entries}`,
      ].join("\n")
    )
    .setFooter({ text: "Only server boosters can enter · Hosted automatically every 2 hours" })
    .setTimestamp();
}

function buildRow(roundId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bgaw_enter_${roundId}`)
      .setLabel("Enter Giveaway")
      .setEmoji("💜")
      .setStyle(ButtonStyle.Primary)
  );
}

// Called from index.ts button handler
export async function handleBoosterEntry(
  client: Client,
  roundId: string,
  userId: string,
  guildId: string
): Promise<string> {
  const round = activeRounds.get(roundId);
  if (!round || round.ended || Date.now() > round.endsAt) {
    return "❌ This giveaway has already ended.";
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return "❌ Could not find server.";

  const boosterRole = guild.roles.premiumSubscriberRole;
  const member = guild.members.cache.get(userId) ??
    await guild.members.fetch(userId).catch(() => null) as GuildMember | null;

  if (!member) return "❌ Could not verify your membership.";
  if (boosterRole && !member.roles.cache.has(boosterRole.id)) {
    return "❌ You must be a 💜 **Server Booster** to enter this giveaway.";
  }

  if (round.entrants.has(userId)) {
    return "✅ You are already entered in this giveaway!";
  }

  round.entrants.add(userId);

  // Update the embed with new entry count
  const guild2 = client.guilds.cache.get(round.guildId);
  const channel = guild2?.channels.cache.get(round.channelId) as TextChannel | undefined;
  if (channel && round.messageId) {
    channel.messages.fetch(round.messageId)
      .then((m) => m.edit({ embeds: [buildEmbed(round.entrants.size, round.endsAt)] }))
      .catch(() => {});
  }

  return `✅ You're entered! Good luck! 🎉\n💜 **${formatNumber(PRIZE_PER_WINNER)} gems** could be yours in ${timeLeft(round.endsAt)}.`;
}

// Resolve the booster giveaway channel for a guild:
// 1. Check DB for admin-configured channel
// 2. Fall back to any channel named "booster-giveaway" (case-insensitive)
async function resolveChannel(client: Client, guildId: string): Promise<string | null> {
  const settings = await getOrCreateGuildSettings(guildId).catch(() => null);
  if (settings?.boosterGiveawayChannelId) return settings.boosterGiveawayChannelId;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  const auto = guild.channels.cache.find(
    (c) =>
      c.type === 0 /* GuildText */ &&
      c.name.toLowerCase().replace(/[\s_]/g, "-") === "booster-giveaway"
  );
  return auto?.id ?? null;
}

// Start the automated cycle per guild
export function startBoosterGiveaway(client: Client): void {
  client.guilds.cache.forEach((guild) => scheduleForGuild(client, guild.id));
  client.on("guildCreate", (guild) => scheduleForGuild(client, guild.id));
}

async function scheduleForGuild(client: Client, guildId: string): Promise<void> {
  const channelId = await resolveChannel(client, guildId);
  if (!channelId) return;

  // Post immediately on start, then every 2 hours
  await postGiveaway(client, guildId, channelId);

  setInterval(async () => {
    const ch = await resolveChannel(client, guildId);
    if (ch) await postGiveaway(client, guildId, ch);
  }, CYCLE_INTERVAL_MS);
}
