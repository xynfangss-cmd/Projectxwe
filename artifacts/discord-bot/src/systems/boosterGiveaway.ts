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
import { getOrCreateGuildSettings, updateGuildSettings, getOrCreateUser, updateUser } from "../utils/db.js";
import { formatNumber } from "../utils/constants.js";

const PRIZE_TOTAL          = 100_000_000;
const WINNER_COUNT         = 2;
const PRIZE_PER_WINNER     = PRIZE_TOTAL / WINNER_COUNT;
const GIVEAWAY_DURATION_MS = 45 * 60 * 1000;   // 45 minutes
const CYCLE_INTERVAL_MS    = 2 * 60 * 60 * 1000; // 2 hours

// ── Active round state ────────────────────────────────────────────────────────
export interface BoosterRound {
  roundId:   string;
  guildId:   string;
  channelId: string;
  messageId: string | null;
  entrants:  Set<string>;
  endsAt:    number;
  ended:     boolean;
}

export const activeRounds = new Map<string, BoosterRound>();
const scheduledGuilds     = new Set<string>();

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRoundId(): string {
  return `bgaw_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
}

function timeLeft(endsAt: number): string {
  const ms = endsAt - Date.now();
  if (ms <= 0) return "Ended";
  const m  = Math.floor(ms / 60_000);
  const s  = Math.floor((ms % 60_000) / 1_000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── Embed builders ────────────────────────────────────────────────────────────
function buildEmbed(entries: number, endsAt: number): EmbedBuilder {
  const endsAtSec = Math.floor(endsAt / 1000);
  return new EmbedBuilder()
    .setColor(0xf47fff)
    .setTitle("💜 Server Booster Giveaway!")
    .setDescription(
      [
        `A **${formatNumber(PRIZE_TOTAL)} gem** prize is up for grabs!`,
        `Split equally between **${WINNER_COUNT} winners** — **${formatNumber(PRIZE_PER_WINNER)} gems each**!`,
        "",
        `> 🏆 **Winners:** ${WINNER_COUNT}`,
        `> 🪙 **Per Winner:** ${formatNumber(PRIZE_PER_WINNER)} gems`,
        `> ⏰ **Ends:** <t:${endsAtSec}:R> (<t:${endsAtSec}:t>)`,
        `> 👥 **Entries:** ${entries}`,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━",
        "**Requirements:** Must be a 💜 **Server Booster**",
        "",
        "Click **Enter Giveaway** below for your chance to win!",
      ].join("\n")
    )
    .setFooter({ text: "Booster Giveaway · Only server boosters can enter · Hosted every 2 hours" })
    .setTimestamp();
}

function buildRow(roundId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bgaw_enter_${roundId}`)
      .setLabel("Enter Giveaway")
      .setEmoji("💜")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

// ── Persist round to DB (so bot restarts can recover it) ─────────────────────
async function saveRound(round: BoosterRound): Promise<void> {
  await updateGuildSettings(round.guildId, {
    lastBoosterGiveawayAt: new Date(),
    boosterRoundId:   round.roundId,
    boosterMessageId: round.messageId ?? undefined,
    boosterEndsAt:    new Date(round.endsAt),
  }).catch(() => {});
}

async function clearRound(guildId: string): Promise<void> {
  await updateGuildSettings(guildId, {
    boosterRoundId:   null,
    boosterMessageId: null,
    boosterEndsAt:    null,
  } as any).catch(() => {});
}

// ── Post a giveaway ───────────────────────────────────────────────────────────
export async function postGiveaway(client: Client, guildId: string, channelId: string): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = (guild.channels.cache.get(channelId) ??
    await guild.channels.fetch(channelId).catch(() => null)) as TextChannel | null;
  if (!channel) return;

  const roundId = makeRoundId();
  const endsAt  = Date.now() + GIVEAWAY_DURATION_MS;

  const msg = await channel.send({
    embeds: [buildEmbed(0, endsAt)],
    components: [buildRow(roundId)],
  }).catch(() => null);
  if (!msg) return;

  const round: BoosterRound = {
    roundId, guildId, channelId,
    messageId: msg.id,
    entrants:  new Set(),
    endsAt,    ended: false,
  };
  activeRounds.set(roundId, round);

  // Persist so a restart can recover this round
  await saveRound(round);

  setTimeout(() => endGiveaway(client, roundId), GIVEAWAY_DURATION_MS);
}

// ── End a giveaway ────────────────────────────────────────────────────────────
async function endGiveaway(client: Client, roundId: string): Promise<void> {
  const round = activeRounds.get(roundId);
  if (!round || round.ended) return;
  round.ended = true;
  activeRounds.delete(roundId);

  // Clear the persisted round immediately so a concurrent restart doesn't re-end it
  await clearRound(round.guildId);

  const guild = client.guilds.cache.get(round.guildId);
  if (!guild) return;

  const channel = (guild.channels.cache.get(round.channelId) ??
    await guild.channels.fetch(round.channelId).catch(() => null)) as TextChannel | null;
  if (!channel) return;

  // Verify each entrant is still a booster
  const boosterRole = guild.roles.premiumSubscriberRole;
  const eligible: string[] = [];
  for (const uid of round.entrants) {
    const member = guild.members.cache.get(uid) ??
      await guild.members.fetch(uid).catch(() => null);
    if (!member) continue;
    if (!boosterRole || member.roles.cache.has(boosterRole.id)) {
      eligible.push(uid);
    }
  }

  const shuffled    = eligible.sort(() => Math.random() - 0.5);
  const winners     = shuffled.slice(0, WINNER_COUNT);
  const perWinner   = winners.length > 0 ? Math.floor(PRIZE_TOTAL / winners.length) : 0;

  // Award gems
  for (const uid of winners) {
    const u = await getOrCreateUser(uid, round.guildId, "").catch(() => null);
    if (u) await updateUser(uid, round.guildId, { credits: u.credits + perWinner }).catch(() => {});
  }

  let resultDesc: string;
  if (winners.length === 0) {
    resultDesc = round.entrants.size === 0
      ? "No one entered this giveaway."
      : "No eligible server boosters entered.";
  } else if (winners.length === 1) {
    resultDesc = `🎉 <@${winners[0]}> won the full **${formatNumber(PRIZE_TOTAL)} gems**!`;
  } else {
    resultDesc = winners.map(w => `🎉 <@${w}> — **+${formatNumber(perWinner)} gems**`).join("\n");
  }

  const endEmbed = new EmbedBuilder()
    .setColor(winners.length > 0 ? 0xffd700 : 0x99aab5)
    .setTitle("🎁 Booster Giveaway — Ended!")
    .setDescription(
      [
        winners.length > 0
          ? `The **${formatNumber(PRIZE_TOTAL)} gem** prize has been awarded!`
          : "This giveaway ended with no winners.",
        "",
        resultDesc,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━",
        `> 👥 **Total Entries:** ${round.entrants.size}`,
        `> 🏆 **Winners:** ${winners.length}`,
        ...(winners.length > 1 ? [`> 🪙 **Per Winner:** ${formatNumber(perWinner)} gems`] : []),
      ].join("\n")
    )
    .setFooter({ text: "Booster Giveaway · Next giveaway in ~2 hours" })
    .setTimestamp();

  // Edit original message and disable button
  if (round.messageId) {
    await channel.messages.fetch(round.messageId)
      .then(m => m.edit({ embeds: [endEmbed], components: [buildRow(roundId, true)] }))
      .catch(() => {});
  }

  // Announce winners
  if (winners.length > 0) {
    await channel.send({
      content: `🎉 Congratulations ${winners.map(w => `<@${w}>`).join(" and ")}! You each won **${formatNumber(perWinner)} gems**! Use \`/balance\` to check your wallet.`,
    }).catch(() => {});
  }
}

// ── Button handler ────────────────────────────────────────────────────────────
export async function handleBoosterEntry(
  client: Client,
  roundId: string,
  userId: string,
  guildId: string,
): Promise<string> {
  const round = activeRounds.get(roundId);
  if (!round || round.ended || Date.now() > round.endsAt) {
    return "❌ This giveaway has already ended.";
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return "❌ Could not find server.";

  const boosterRole = guild.roles.premiumSubscriberRole;
  const member = (guild.members.cache.get(userId) ??
    await guild.members.fetch(userId).catch(() => null)) as GuildMember | null;

  if (!member) return "❌ Could not verify your membership.";
  if (boosterRole && !member.roles.cache.has(boosterRole.id)) {
    return "❌ You must be a 💜 **Server Booster** to enter this giveaway.";
  }
  if (round.entrants.has(userId)) return "✅ You are already entered — good luck!";

  round.entrants.add(userId);

  // Update entry count on embed
  const ch = (guild.channels.cache.get(round.channelId)) as TextChannel | undefined;
  if (ch && round.messageId) {
    ch.messages.fetch(round.messageId)
      .then(m => m.edit({ embeds: [buildEmbed(round.entrants.size, round.endsAt)] }))
      .catch(() => {});
  }

  return `✅ You're entered! Good luck! 🎉\n💜 **${formatNumber(PRIZE_PER_WINNER)} gems** could be yours in ${timeLeft(round.endsAt)}.`;
}

// ── Channel resolver ──────────────────────────────────────────────────────────
async function resolveChannel(client: Client, guildId: string): Promise<string | null> {
  const settings = await getOrCreateGuildSettings(guildId).catch(() => null);
  if (settings?.boosterGiveawayChannelId) return settings.boosterGiveawayChannelId;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  const auto = guild.channels.cache.find(
    c => c.type === 0 && c.name.toLowerCase().replace(/[\s_]/g, "-") === "booster-giveaway"
  );
  return auto?.id ?? null;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
async function scheduleForGuild(client: Client, guildId: string): Promise<void> {
  if (scheduledGuilds.has(guildId)) return;

  const channelId = await resolveChannel(client, guildId);
  if (!channelId) return;

  scheduledGuilds.add(guildId);

  const settings = await getOrCreateGuildSettings(guildId).catch(() => null);

  // ── Recover an active round interrupted by a restart ──────────────────────
  if (settings?.boosterRoundId && settings?.boosterMessageId && settings?.boosterEndsAt) {
    const endsAt      = new Date(settings.boosterEndsAt).getTime();
    const remainingMs = endsAt - Date.now();

    if (remainingMs > 5_000) {
      const round: BoosterRound = {
        roundId:   settings.boosterRoundId,
        guildId,
        channelId,
        messageId: settings.boosterMessageId,
        entrants:  new Set(), // entrants were in memory — can't recover, no gems this cycle
        endsAt,
        ended:     false,
      };
      activeRounds.set(round.roundId, round);
      console.log(`[BoosterGiveaway] Recovered round ${round.roundId}, ends in ${Math.round(remainingMs / 60_000)}m`);

      setTimeout(async () => {
        await endGiveaway(client, round.roundId);
        // Restart regular cycle after this recovered round ends
        setInterval(async () => {
          const ch = await resolveChannel(client, guildId);
          if (ch) await postGiveaway(client, guildId, ch);
        }, CYCLE_INTERVAL_MS);
      }, remainingMs);
      return;
    }
  }

  // ── Normal scheduling ─────────────────────────────────────────────────────
  const lastAt      = settings?.lastBoosterGiveawayAt ? new Date(settings.lastBoosterGiveawayAt).getTime() : 0;
  const elapsed     = Date.now() - lastAt;
  const msUntilNext = Math.max(0, CYCLE_INTERVAL_MS - elapsed);

  console.log(
    `[BoosterGiveaway] Guild ${guildId}: last posted ${Math.round(elapsed / 60_000)}m ago. ` +
    `Next in ${Math.round(msUntilNext / 60_000)}m.`
  );

  setTimeout(async () => {
    const ch = await resolveChannel(client, guildId);
    if (ch) await postGiveaway(client, guildId, ch);

    setInterval(async () => {
      const ch2 = await resolveChannel(client, guildId);
      if (ch2) await postGiveaway(client, guildId, ch2);
    }, CYCLE_INTERVAL_MS);
  }, msUntilNext);
}

export function startBoosterGiveaway(client: Client): void {
  setTimeout(() => {
    client.guilds.cache.forEach(guild => scheduleForGuild(client, guild.id));
  }, 3_000);

  client.on("guildCreate", guild => scheduleForGuild(client, guild.id));
}
