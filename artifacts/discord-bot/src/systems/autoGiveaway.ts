import {
  Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  Role,
} from "discord.js";
import { getOrCreateGuildSettings, updateGuildSettings, getOrCreateUser, updateUser } from "../utils/db.js";
import { formatNumber } from "../utils/constants.js";

const CYCLE_MS      = 45 * 60 * 1000;   // every 45 minutes
const DURATION_MS   = 15 * 60 * 1000;   // open for 15 minutes
const MIN_PRIZE     = 1_000_000;
const MAX_PRIZE     = 50_000_000;
const MIN_WINNERS   = 1;
const MAX_WINNERS   = 3;

// ── Active round state ────────────────────────────────────────────────────────
interface AutoRound {
  roundId:   string;
  guildId:   string;
  channelId: string;
  messageId: string | null;
  prize:     number;        // total prize pool
  maxWinners: number;       // how many winners will be drawn
  entrants:  Set<string>;
  endsAt:    number;
  ended:     boolean;
}

const activeRounds = new Map<string, AutoRound>();
const scheduledGuilds = new Set<string>();

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRoundId(): string {
  return `agaw_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function timeLeft(endsAt: number): string {
  const ms = endsAt - Date.now();
  if (ms <= 0) return "Ended";
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function prizeColor(prize: number): number {
  if (prize >= 40_000_000) return 0xffd700;  // gold
  if (prize >= 20_000_000) return 0x57f287;  // green
  if (prize >= 10_000_000) return 0x5865f2;  // blurple
  return 0x00b0f4;                            // blue
}

function prizeEmoji(prize: number): string {
  if (prize >= 40_000_000) return "💰";
  if (prize >= 20_000_000) return "💎";
  if (prize >= 10_000_000) return "🎁";
  return "✨";
}

function winnerLabel(n: number): string {
  return n === 1 ? "1 Winner" : `${n} Winners`;
}

// ── Embed builders ────────────────────────────────────────────────────────────
function buildEmbed(round: AutoRound): EmbedBuilder {
  const perWinner = Math.floor(round.prize / round.maxWinners);
  const emoji     = prizeEmoji(round.prize);
  const color     = prizeColor(round.prize);
  const endsAt    = Math.floor(round.endsAt / 1000);

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} Gem Giveaway — ${formatNumber(round.prize)} Gems!`)
    .setDescription(
      [
        `> 💎 **Prize Pool:** ${formatNumber(round.prize)} gems`,
        `> 🏆 **Winners:** ${winnerLabel(round.maxWinners)}`,
        `> 🪙 **Per Winner:** ${formatNumber(perWinner)} gems`,
        `> ⏰ **Ends:** <t:${endsAt}:R> (<t:${endsAt}:t>)`,
        `> 👥 **Entries:** ${round.entrants.size}`,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━",
        "🎉 Press **Enter Giveaway** below for your chance to win!",
      ].join("\n")
    )
    .addFields(
      { name: "🎁 How to Enter", value: "Click the button below — one entry per member.", inline: false },
    )
    .setFooter({ text: "Auto Giveaway · Hosted every 45 minutes · Good luck!" })
    .setTimestamp();
}

function buildRow(roundId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`autogaw_enter_${roundId}`)
      .setLabel("Enter Giveaway")
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

// ── Find or create the "Giveaway Ping" role ───────────────────────────────────
async function getOrCreatePingRole(client: Client, guildId: string): Promise<Role | null> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  // Check DB cache first
  const settings = await getOrCreateGuildSettings(guildId).catch(() => null);
  if (settings?.giveawayPingRoleId) {
    const cached = guild.roles.cache.get(settings.giveawayPingRoleId) ??
      await guild.roles.fetch(settings.giveawayPingRoleId).catch(() => null);
    if (cached) return cached;
  }

  // Try to find by name
  await guild.roles.fetch().catch(() => {});
  const existing = guild.roles.cache.find(
    r => r.name.toLowerCase() === "giveaway ping"
  );
  if (existing) {
    await updateGuildSettings(guildId, { giveawayPingRoleId: existing.id }).catch(() => {});
    return existing;
  }

  // Create it
  const created = await guild.roles.create({
    name:        "Giveaway Ping",
    color:       0xffd700,
    mentionable: true,
    reason:      "Auto-created for giveaway ping notifications",
  }).catch(() => null);

  if (created) {
    await updateGuildSettings(guildId, { giveawayPingRoleId: created.id }).catch(() => {});
  }
  return created;
}

// ── Post a giveaway ───────────────────────────────────────────────────────────
async function postGiveaway(client: Client, guildId: string, channelId: string): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
  if (!channel) return;

  // Stamp to DB first to throttle restarts
  await updateGuildSettings(guildId, { lastAutoGiveawayAt: new Date() }).catch(() => {});

  const prize      = randomBetween(MIN_PRIZE, MAX_PRIZE);
  const maxWinners = randomBetween(MIN_WINNERS, MAX_WINNERS);
  const roundId    = makeRoundId();
  const endsAt     = Date.now() + DURATION_MS;

  const round: AutoRound = {
    roundId, guildId, channelId, messageId: null,
    prize, maxWinners, entrants: new Set(), endsAt, ended: false,
  };
  activeRounds.set(roundId, round);

  // Use Giveaway Ping role instead of @everyone
  const pingRole   = await getOrCreatePingRole(client, guildId);
  const pingContent = pingRole
    ? `<@&${pingRole.id}> 🎉 A new giveaway has started!`
    : "🎉 A new giveaway has started!";

  const msg = await channel.send({
    content: pingContent,
    allowedMentions: { roles: pingRole ? [pingRole.id] : [] },
    embeds: [buildEmbed(round)],
    components: [buildRow(roundId)],
  }).catch(() => null);

  if (msg) round.messageId = msg.id;

  // Schedule end
  setTimeout(() => endGiveaway(client, roundId), DURATION_MS);
}

// ── End a giveaway ────────────────────────────────────────────────────────────
async function endGiveaway(client: Client, roundId: string): Promise<void> {
  const round = activeRounds.get(roundId);
  if (!round || round.ended) return;
  round.ended = true;

  const guild   = client.guilds.cache.get(round.guildId);
  const channel = guild?.channels.cache.get(round.channelId) as TextChannel | undefined;

  // Pick winners
  const pool     = [...round.entrants].sort(() => Math.random() - 0.5);
  const winners  = pool.slice(0, round.maxWinners);
  const perWinner = winners.length > 0 ? Math.floor(round.prize / winners.length) : 0;

  // Award gems
  for (const uid of winners) {
    const u = await getOrCreateUser(uid, round.guildId, "").catch(() => null);
    if (u) await updateUser(uid, round.guildId, { credits: u.credits + perWinner }).catch(() => {});
  }

  // Build result embed
  let resultDesc: string;
  if (winners.length === 0) {
    resultDesc = "No one entered — no winners this time!";
  } else if (winners.length === 1) {
    resultDesc = `🎉 <@${winners[0]}> won **${formatNumber(perWinner)} gems**!`;
  } else {
    resultDesc = [
      `The **${formatNumber(round.prize)} gem** pot was split between **${winners.length} winners**:`,
      ...winners.map((w) => `🎉 <@${w}> **+${formatNumber(perWinner)} gems**`),
    ].join("\n");
  }

  const endEmbed = new EmbedBuilder()
    .setColor(winners.length > 0 ? prizeColor(round.prize) : 0x99aab5)
    .setTitle(`${prizeEmoji(round.prize)} Giveaway Ended!`)
    .setDescription(
      [
        resultDesc,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━",
        `> 💎 **Total Prize:** ${formatNumber(round.prize)} gems`,
        `> 👥 **Total Entries:** ${round.entrants.size}`,
        `> 🏆 **Winners:** ${winners.length}`,
        ...(winners.length > 1 ? [`> 🪙 **Per Winner:** ${formatNumber(perWinner)} gems`] : []),
      ].join("\n")
    )
    .setFooter({ text: "Auto Giveaway · Next giveaway in ~45 minutes · Stay active!" })
    .setTimestamp();

  // Edit original message — show disabled button
  if (channel && round.messageId) {
    await channel.messages
      .fetch(round.messageId)
      .then((m) => m.edit({ embeds: [endEmbed], components: [buildRow(round.roundId, true)] }))
      .catch(() => {});
  }

  // Ping winners
  if (channel && winners.length > 0) {
    await channel.send({
      content: `🎉 Congratulations ${winners.map((w) => `<@${w}>`).join(", ")}! You each won **${formatNumber(perWinner)} gems**! Check your balance with \`/balance\`.`,
    }).catch(() => {});
  }

  activeRounds.delete(roundId);
}

// ── Button handler ────────────────────────────────────────────────────────────
export async function handleAutoGawEntry(
  roundId: string,
  userId: string,
): Promise<string> {
  const round = activeRounds.get(roundId);
  if (!round || round.ended || Date.now() > round.endsAt) {
    return "❌ This giveaway has already ended.";
  }
  if (round.entrants.has(userId)) {
    return "✅ You're already entered — good luck!";
  }

  round.entrants.add(userId);

  // Update embed entry count
  return `✅ You're entered! 🎉 Good luck — **${formatNumber(Math.floor(round.prize / round.maxWinners))} gems** per winner!`;
}

// ── Channel resolver ──────────────────────────────────────────────────────────
const CHANNEL_NAME_VARIANTS = [
  "auto-giveaways", "auto-giveaway", "giveaways", "giveaway",
  "gem-giveaway", "gem-giveaways",
];

async function resolveChannel(client: Client, guildId: string): Promise<string | null> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  // 1. Check DB-configured channel
  const settings = await getOrCreateGuildSettings(guildId).catch(() => null);
  if (settings?.giveawayChannelId) {
    const dbCh = guild.channels.cache.get(settings.giveawayChannelId) ??
      await guild.channels.fetch(settings.giveawayChannelId).catch(() => null);
    if (dbCh) return dbCh.id;
  }

  // 2. Search by name variants
  await guild.channels.fetch().catch(() => {});
  const ch = guild.channels.cache.find(c => {
    if (c.type !== 0) return false;
    const norm = c.name.toLowerCase().replace(/[\s_]/g, "-");
    return CHANNEL_NAME_VARIANTS.includes(norm);
  });

  if (ch) {
    console.log(`[AutoGiveaway] Found channel "${ch.name}" (${ch.id}) for guild ${guildId}`);
    return ch.id;
  }

  console.warn(`[AutoGiveaway] No giveaway channel found for guild ${guildId}. ` +
    `Create a channel named "giveaways" or set one via /admin setup.`);
  return null;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
async function scheduleForGuild(client: Client, guildId: string): Promise<void> {
  if (scheduledGuilds.has(guildId)) return;

  const channelId = await resolveChannel(client, guildId);
  if (!channelId) return;

  scheduledGuilds.add(guildId);

  const settings    = await getOrCreateGuildSettings(guildId).catch(() => null);
  const lastAt      = settings?.lastAutoGiveawayAt ? new Date(settings.lastAutoGiveawayAt).getTime() : 0;
  const elapsed     = Date.now() - lastAt;
  const msUntilNext = Math.max(0, CYCLE_MS - elapsed);

  console.log(
    `[AutoGiveaway] Guild ${guildId}: last posted ${Math.round(elapsed / 60_000)}m ago. ` +
    `Next in ${Math.round(msUntilNext / 60_000)}m. (cycle: 45m)`
  );

  setTimeout(async () => {
    const ch = await resolveChannel(client, guildId);
    if (ch) await postGiveaway(client, guildId, ch);

    setInterval(async () => {
      const ch2 = await resolveChannel(client, guildId);
      if (ch2) await postGiveaway(client, guildId, ch2);
    }, CYCLE_MS);
  }, msUntilNext);
}

export function startAutoGiveaway(client: Client): void {
  setTimeout(() => {
    client.guilds.cache.forEach((guild) => scheduleForGuild(client, guild.id));
  }, 4_000); // slightly after booster giveaway init

  client.on("guildCreate", (guild) => scheduleForGuild(client, guild.id));
}
