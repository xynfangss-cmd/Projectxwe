import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { getOrCreateUser, updateUser } from "../utils/db.js";
import { formatNumber, parseAmount } from "../utils/constants.js";

// ── Bitmask helpers (20 tiles, indices 0-19) ─────────────────────────────────
const TOTAL_TILES = 20;

function bitGet(mask: number, idx: number) { return (mask >> idx) & 1; }
function bitSet(mask: number, idx: number) { return mask | (1 << idx); }
function bitCount(mask: number) {
  let n = 0;
  for (let i = 0; i < TOTAL_TILES; i++) if ((mask >> i) & 1) n++;
  return n;
}

// ── Multiplier (3% house edge) ────────────────────────────────────────────────
function calcMultiplier(mineCount: number, gemsFound: number): number {
  if (gemsFound === 0) return 1.0;
  let mult = 1.0;
  for (let i = 0; i < gemsFound; i++) {
    const remaining = TOTAL_TILES - i;
    const safe = TOTAL_TILES - mineCount - i;
    if (safe <= 0) break;
    mult *= remaining / safe;
  }
  return parseFloat((mult * 0.97).toFixed(2));
}

// ── CustomId encoding ─────────────────────────────────────────────────────────
// Tile:    mines_t_{idx}_{ownerId}_{minesBitmask}_{revealedBitmask}_{bet}
// Cashout: mines_c_{ownerId}_{minesBitmask}_{revealedBitmask}_{bet}

function tileId(idx: number, ownerId: string, mines: number, revealed: number, bet: number) {
  return `mines_t_${idx}_${ownerId}_${mines}_${revealed}_${bet}`;
}
function cashoutId(ownerId: string, mines: number, revealed: number, bet: number) {
  return `mines_c_${ownerId}_${mines}_${revealed}_${bet}`;
}

interface MinesState {
  idx?: number;
  ownerId: string;
  minesBitmask: number;
  revealedBitmask: number;
  bet: number;
}

function parseMinesId(customId: string): MinesState | null {
  try {
    const parts = customId.split("_");
    if (parts[0] !== "mines") return null;
    if (parts[1] === "t") {
      // mines_t_{idx}_{ownerId}_{mines}_{revealed}_{bet}
      return {
        idx: parseInt(parts[2]),
        ownerId: parts[3],
        minesBitmask: parseInt(parts[4]),
        revealedBitmask: parseInt(parts[5]),
        bet: parseInt(parts[6]),
      };
    }
    if (parts[1] === "c") {
      // mines_c_{ownerId}_{mines}_{revealed}_{bet}
      return {
        ownerId: parts[2],
        minesBitmask: parseInt(parts[3]),
        revealedBitmask: parseInt(parts[4]),
        bet: parseInt(parts[5]),
      };
    }
    return null;
  } catch { return null; }
}

// ── Build the embed ───────────────────────────────────────────────────────────
function buildEmbed(
  mines: number, revealed: number, mineCount: number,
  bet: number, result?: "cashout" | "exploded"
): EmbedBuilder {
  const gemsFound = bitCount(revealed & ~mines);
  const mult = calcMultiplier(mineCount, gemsFound);
  const potential = Math.floor(bet * mult);

  const color = result === "cashout" ? 0x57f287 : result === "exploded" ? 0xed4245 : 0x5865f2;
  const title = result === "cashout" ? "💰 Mines — Cashed Out!" : result === "exploded" ? "💣 Mines — BOOM!" : "💣 Mines";

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: "💰 Bet", value: `${formatNumber(bet)} gems`, inline: true },
      { name: "💣 Mines", value: `${mineCount}`, inline: true },
      { name: "💎 Found", value: `${gemsFound}`, inline: true },
    )
    .setTimestamp();

  if (result === "cashout") {
    embed.setDescription(`Cashed out at **${mult}x** — **+${formatNumber(potential)} gems**! 💰`);
  } else if (result === "exploded") {
    embed.setDescription(`You hit a mine after ${gemsFound} gem(s). **-${formatNumber(bet)} gems** 💥`);
  } else if (gemsFound > 0) {
    embed.setDescription(`**${gemsFound}** gem(s) found — current payout: **${formatNumber(potential)} gems (${mult}x)**\nKeep going or cash out!`);
  } else {
    embed.setDescription(`Click tiles to find 💎 gems. Avoid the 💣 mines!\nCash out anytime to lock in your winnings.`);
  }

  return embed;
}

// ── Build the 5-row button grid ───────────────────────────────────────────────
function buildComponents(
  ownerId: string, minesBitmask: number, revealedBitmask: number,
  bet: number, revealAll = false
): ActionRowBuilder<ButtonBuilder>[] {
  const mineCount = bitCount(minesBitmask);
  const gemsFound = bitCount(revealedBitmask & ~minesBitmask);
  const mult = calcMultiplier(mineCount, gemsFound);
  const potential = Math.floor(bet * mult);
  const done = revealAll;

  const tileRows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let row = 0; row < 4; row++) {
    const ar = new ActionRowBuilder<ButtonBuilder>();
    for (let col = 0; col < 5; col++) {
      const idx = row * 5 + col;
      const isRevealed = bitGet(revealedBitmask, idx) === 1;
      const isMineHere = bitGet(minesBitmask, idx) === 1;

      let emoji: string;
      let style: ButtonStyle;
      let disabled: boolean;

      if (isRevealed) {
        // Already clicked
        if (isMineHere) {
          emoji = "💣";
          style = ButtonStyle.Danger;
        } else {
          emoji = "💎";
          style = ButtonStyle.Success;
        }
        disabled = true;
      } else if (revealAll) {
        // Game over — show all
        emoji = isMineHere ? "💣" : "💎";
        style = isMineHere ? ButtonStyle.Danger : ButtonStyle.Secondary;
        disabled = true;
      } else {
        // Hidden, clickable
        emoji = "⬛";
        style = ButtonStyle.Secondary;
        disabled = done;
      }

      ar.addComponents(
        new ButtonBuilder()
          .setCustomId(tileId(idx, ownerId, minesBitmask, revealedBitmask, bet))
          .setEmoji(emoji)
          .setStyle(style)
          .setDisabled(disabled)
      );
    }
    tileRows.push(ar);
  }

  // Row 5: Cash Out
  const cashOutRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cashoutId(ownerId, minesBitmask, revealedBitmask, bet))
      .setLabel(gemsFound > 0 ? `Cash Out  ${formatNumber(potential)} gems (${mult}x)` : "Cash Out")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Success)
      .setDisabled(done || gemsFound === 0)
  );
  tileRows.push(cashOutRow);

  return tileRows;
}

// ── /mines slash command ──────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("mines")
  .setDescription("Play Mines — reveal gems without hitting a bomb!")
  .addStringOption((opt) =>
    opt.setName("bet").setDescription("Amount of gems to bet (e.g. 1k, 5m, 100)").setRequired(true)
  )
  .addIntegerOption((opt) =>
    opt.setName("mines").setDescription("Number of mines (1–9, default 3)").setRequired(false).setMinValue(1).setMaxValue(9)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const betRaw = interaction.options.getString("bet", true);
  const bet    = parseAmount(betRaw);
  if (!bet || bet < 100) {
    await interaction.reply({ content: "❌ Invalid bet. Minimum is 100 gems. Use e.g. `100`, `1k`, `5m`.", flags: 64 });
    return;
  }
  const mineCount = interaction.options.getInteger("mines") ?? 3;

  const dbUser = await getOrCreateUser(userId, guildId, interaction.user.username);
  if (dbUser.credits < bet) {
    await interaction.reply({
      content: `You only have **${formatNumber(dbUser.credits)}** gems — not enough to bet **${formatNumber(bet)}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await updateUser(userId, guildId, { credits: dbUser.credits - bet });

  // Randomly place mines
  let minesBitmask = 0;
  const shuffled = Array.from({ length: TOTAL_TILES }, (_, i) => i).sort(() => Math.random() - 0.5);
  for (let i = 0; i < mineCount; i++) minesBitmask = bitSet(minesBitmask, shuffled[i]);

  const revealedBitmask = 0;

  await interaction.reply({
    embeds: [buildEmbed(minesBitmask, revealedBitmask, mineCount, bet)],
    components: buildComponents(userId, minesBitmask, revealedBitmask, bet),
  });
}

// ── Button handler ────────────────────────────────────────────────────────────
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const state = parseMinesId(interaction.customId);
  if (!state) return;

  // Ownership check
  if (state.ownerId !== interaction.user.id) {
    await interaction.reply({ content: "This isn't your game!", flags: MessageFlags.Ephemeral });
    return;
  }

  const { ownerId, minesBitmask, revealedBitmask, bet } = state;
  const mineCount = bitCount(minesBitmask);
  const guildId = interaction.guildId!;

  // Acknowledge immediately to avoid "Unknown interaction" timeout
  await interaction.deferUpdate();

  // ── CASH OUT ──────────────────────────────────────────────────────────────
  if (interaction.customId.startsWith("mines_c_")) {
    const gemsFound = bitCount(revealedBitmask & ~minesBitmask);
    if (gemsFound === 0) return;

    const mult = calcMultiplier(mineCount, gemsFound);
    const payout = Math.floor(bet * mult);

    const dbUser = await getOrCreateUser(ownerId, guildId, "");
    await updateUser(ownerId, guildId, { credits: dbUser.credits + payout });

    await interaction.editReply({
      embeds: [buildEmbed(minesBitmask, revealedBitmask, mineCount, bet, "cashout")],
      components: buildComponents(ownerId, minesBitmask, revealedBitmask, bet, true),
    });
    return;
  }

  // ── TILE CLICK ────────────────────────────────────────────────────────────
  if (interaction.customId.startsWith("mines_t_")) {
    const { idx } = state;
    if (idx === undefined || idx < 0 || idx >= TOTAL_TILES) return;
    if (bitGet(revealedBitmask, idx) === 1) return; // already revealed

    const newRevealed = bitSet(revealedBitmask, idx);

    if (bitGet(minesBitmask, idx) === 1) {
      // Hit a mine!
      await interaction.editReply({
        embeds: [buildEmbed(minesBitmask, newRevealed, mineCount, bet, "exploded")],
        components: buildComponents(ownerId, minesBitmask, newRevealed, bet, true),
      });
      return;
    }

    // Safe tile — check if all safe tiles found
    const gemsFound = bitCount(newRevealed & ~minesBitmask);
    const safeTiles = TOTAL_TILES - mineCount;

    if (gemsFound >= safeTiles) {
      // Swept the board — auto cash out!
      const mult = calcMultiplier(mineCount, gemsFound);
      const payout = Math.floor(bet * mult);
      const dbUser = await getOrCreateUser(ownerId, guildId, "");
      await updateUser(ownerId, guildId, { credits: dbUser.credits + payout });

      await interaction.editReply({
        embeds: [buildEmbed(minesBitmask, newRevealed, mineCount, bet, "cashout")],
        components: buildComponents(ownerId, minesBitmask, newRevealed, bet, true),
      });
      return;
    }

    // Update board
    await interaction.editReply({
      embeds: [buildEmbed(minesBitmask, newRevealed, mineCount, bet)],
      components: buildComponents(ownerId, minesBitmask, newRevealed, bet),
    });
    return;
  }
}
