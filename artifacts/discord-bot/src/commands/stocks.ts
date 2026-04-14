import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  MessageFlags,
} from "discord.js";
import { getOrCreateUser, updateUser } from "../utils/db.js";
import { formatNumber } from "../utils/constants.js";

// ── In-memory pending games ────────────────────────────────────────────────
interface StockGame {
  userId:  string;
  guildId: string;
  bet:     number;   // current active bet (doubles on D-o-N)
  doubled: boolean;  // whether D-o-N has already been used
}

const pending = new Map<string, StockGame>();

// ── Helpers ────────────────────────────────────────────────────────────────
const TICKERS  = ["$GEMX", "$DIMD", "$CRYX", "$RUBX", "$SAPX", "$PLAX", "$TITX"];
const CHARTS   = [
  "▁▂▄▆▇█▇▅▃▂▄▆█",
  "█▇▅▃▁▂▄▆▇█▆▄▂",
  "▂▄▆█▇▅▄▃▂▁▃▅▇",
  "▅▆▇█▇▆▅▄▃▂▃▄▅",
  "▁▁▂▃▅▇█▇▅▃▂▁▁",
  "█▆▄▂▁▂▄▆█▇▅▃▁",
  "▃▄▅▆▇█▇▆▅▄▃▂▁",
];
const MOODS = [
  "📊 **Volatile session** — market swings detected",
  "🌡️ **High-risk window** — momentum is building",
  "⚡ **Flash surge alert** — unusual activity",
  "🔍 **Analyst rating: BUY** — but no guarantees",
  "📉📈 **Mixed signals** — coin toss territory",
  "🧨 **Market unstable** — gamble at your own risk",
  "🚦 **Neutral sentiment** — 50/50 by the algo",
];

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildPendingEmbed(ticker: string, chart: string, mood: string, bet: number, doubled: boolean): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x00d4aa)
    .setTitle("📈 GEM STOCK EXCHANGE")
    .setDescription(
      [
        `\`\`\``,
        `  GEM EXCHANGE  •  LIVE MARKET`,
        `  ─────────────────────────────`,
        `  Ticker  : ${ticker}`,
        `  Price   : ${formatNumber(bet)} 💎`,
        `  Risk    : HIGH`,
        `  Odds    : 50 / 50`,
        `  Mode    : ${doubled ? "DOUBLE OR NOTHING ⚡" : "STANDARD TRADE"}`,
        `\`\`\``,
      ].join("\n")
    )
    .addFields(
      {
        name: "📊 Chart",
        value: `\`${chart}\``,
        inline: false,
      },
      {
        name: "💰 Your Investment",
        value: `💎 **${formatNumber(bet)}** gems`,
        inline: true,
      },
      {
        name: "🏆 Potential Return",
        value: `💎 **${formatNumber(bet * 2)}** gems`,
        inline: true,
      },
      {
        name: "📣 Market Signal",
        value: mood,
        inline: false,
      }
    )
    .setFooter({ text: doubled ? "⚡ Double or Nothing active — stake is locked in!" : "Press Accept to execute the trade • Double to 2× your stake" })
    .setTimestamp();
}

function buildResultEmbed(ticker: string, bet: number, won: boolean, newBalance: number): EmbedBuilder {
  if (won) {
    return new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("📈 TRADE COMPLETE — PROFIT!")
      .setDescription(
        [
          "```",
          `  ${ticker} surged +100%! 🚀`,
          `  ─────────────────────────`,
          `  Result   : WIN`,
          `  Invested : ${formatNumber(bet)} 💎`,
          `  Returned : ${formatNumber(bet * 2)} 💎`,
          `  Profit   : +${formatNumber(bet)} 💎`,
          "```",
        ].join("\n")
      )
      .addFields({ name: "💎 New Balance", value: formatNumber(newBalance), inline: true })
      .setFooter({ text: "💹 The market rewarded you today!" })
      .setTimestamp();
  }

  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("📉 TRADE COMPLETE — LOSS!")
    .setDescription(
      [
        "```",
        `  ${ticker} crashed to zero! 💥`,
        `  ─────────────────────────`,
        `  Result   : LOSS`,
        `  Invested : ${formatNumber(bet)} 💎`,
        `  Returned : 0 💎`,
        `  Loss     : -${formatNumber(bet)} 💎`,
        "```",
      ].join("\n")
    )
    .addFields({ name: "💎 New Balance", value: formatNumber(newBalance), inline: true })
    .setFooter({ text: "📉 The market is ruthless. Better luck next time." })
    .setTimestamp();
}

// ── Slash command ──────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("stocks")
  .setDescription("Invest gems in the GEM Stock Exchange — 50/50 chance to double your money!")
  .addIntegerOption((opt) =>
    opt
      .setName("amount")
      .setDescription("How many gems to invest")
      .setRequired(true)
      .setMinValue(1)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try { await interaction.deferReply(); } catch { return; }

  const amount  = interaction.options.getInteger("amount", true);
  const userId  = interaction.user.id;
  const guildId = interaction.guildId!;

  // Prevent concurrent games
  if (pending.has(userId)) {
    await interaction.editReply({ content: "❌ You already have an active stock trade open! Resolve it first." });
    return;
  }

  const dbUser = await getOrCreateUser(userId, guildId, interaction.user.username);

  if (dbUser.credits < amount) {
    await interaction.editReply({
      content: `❌ You only have **${formatNumber(dbUser.credits)} gems** — you need **${formatNumber(amount)}**.`,
    });
    return;
  }

  // Deduct bet immediately to lock funds
  await updateUser(userId, guildId, { credits: dbUser.credits - amount });

  // Store pending game
  const ticker = randomElement(TICKERS);
  const chart  = randomElement(CHARTS);
  const mood   = randomElement(MOODS);

  pending.set(userId, { userId, guildId, bet: amount, doubled: false });

  // Attach metadata to the message so we can retrieve it in button handlers
  const embed = buildPendingEmbed(ticker, chart, mood, amount, false);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`stocks_accept:${userId}:${ticker}`)
      .setLabel("Accept Trade")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`stocks_double:${userId}:${ticker}`)
      .setLabel("Double or Nothing")
      .setEmoji("🎰")
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ── Button handler (called from index.ts) ─────────────────────────────────
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const [action, ownerId, ticker] = interaction.customId.split(":");
  const clicker = interaction.user.id;

  // Only the original player can interact
  if (clicker !== ownerId) {
    try {
      await interaction.reply({ content: "❌ This is not your trade!", flags: MessageFlags.Ephemeral });
    } catch { /* ignore */ }
    return;
  }

  try { await interaction.deferUpdate(); } catch { return; }

  const game = pending.get(ownerId);
  if (!game) {
    await interaction.editReply({ content: "⚠️ This trade has already been resolved.", components: [] });
    return;
  }

  const { guildId, bet, doubled } = game;

  // ── Double or Nothing ────────────────────────────────────────────────────
  if (action === "stocks_double") {
    if (doubled) {
      await interaction.followUp({ content: "⚠️ You can only double once!", flags: MessageFlags.Ephemeral });
      return;
    }

    // Check if user has enough gems for the extra bet
    const dbUser = await getOrCreateUser(ownerId, guildId, interaction.user.username);
    if (dbUser.credits < bet) {
      await interaction.followUp({
        content: `❌ You need **${formatNumber(bet)} more gems** to double — you only have **${formatNumber(dbUser.credits)}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Deduct extra bet, double the stake
    await updateUser(ownerId, guildId, { credits: dbUser.credits - bet });
    const newBet = bet * 2;
    pending.set(ownerId, { ...game, bet: newBet, doubled: true });

    const newChart = randomElement(CHARTS);
    const newMood  = randomElement(MOODS);
    const embed    = buildPendingEmbed(ticker, newChart, newMood, newBet, true);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`stocks_accept:${ownerId}:${ticker}`)
        .setLabel("Accept Trade")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`stocks_double:${ownerId}:${ticker}`)
        .setLabel("Double or Nothing")
        .setEmoji("🎰")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true),
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
    return;
  }

  // ── Accept Trade ─────────────────────────────────────────────────────────
  if (action === "stocks_accept") {
    pending.delete(ownerId);

    const won = Math.random() < 0.5;
    const dbUser = await getOrCreateUser(ownerId, guildId, interaction.user.username);

    let newBalance = dbUser.credits;
    if (won) {
      newBalance = dbUser.credits + bet * 2;
      await updateUser(ownerId, guildId, { credits: newBalance });
    }
    // on loss: gems were already deducted at game start — nothing to do

    const embed = buildResultEmbed(ticker, bet, won, newBalance);
    await interaction.editReply({ embeds: [embed], components: [] });
  }
}
