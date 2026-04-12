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
import { formatNumber } from "../utils/constants.js";

// ── Types ────────────────────────────────────────────────────────────────────
// 20-tile board (4 rows × 5 cols), 5th row is the Cash Out button
type TileState = "hidden" | "gem" | "mine";

type MinesGame = {
  board: TileState[];     // 20 tiles
  isMine: boolean[];      // which tiles are mines (fixed at start)
  bet: number;
  mineCount: number;
  gemsFound: number;
  userId: string;
  guildId: string;
  status: "playing" | "done";
};

// ── Active games ──────────────────────────────────────────────────────────────
export const games = new Map<string, MinesGame>();

// ── Multiplier formula ────────────────────────────────────────────────────────
// Product of (total / safe_remaining) for each reveal, with 3% house edge
function calcMultiplier(mineCount: number, gemsFound: number, total = 20): number {
  if (gemsFound === 0) return 1.0;
  let mult = 1.0;
  for (let i = 0; i < gemsFound; i++) {
    const remaining = total - i;
    const safeTiles = total - mineCount - i;
    if (safeTiles <= 0) break;
    mult *= remaining / safeTiles;
  }
  return parseFloat((mult * 0.97).toFixed(2));
}

// ── Build the 5-row component layout ─────────────────────────────────────────
function buildComponents(game: MinesGame, revealAll = false): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  // Rows 0-3: tiles 0-19 (4 rows × 5 cols)
  for (let row = 0; row < 4; row++) {
    const actionRow = new ActionRowBuilder<ButtonBuilder>();
    for (let col = 0; col < 5; col++) {
      const idx = row * 5 + col;
      const state = game.board[idx];
      const isMineHere = game.isMine[idx];

      let emoji = "🔲";
      let style = ButtonStyle.Secondary;
      let disabled = game.status === "done";

      if (state === "gem") {
        emoji = "💎";
        style = ButtonStyle.Success;
        disabled = true;
      } else if (state === "mine") {
        emoji = "💣";
        style = ButtonStyle.Danger;
        disabled = true;
      } else if (revealAll) {
        // Reveal all hidden tiles at game end
        emoji = isMineHere ? "💣" : "💎";
        style = isMineHere ? ButtonStyle.Danger : ButtonStyle.Success;
        disabled = true;
      }

      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`mines_tile_${game.userId}_${idx}`)
          .setEmoji(emoji)
          .setStyle(style)
          .setLabel("\u200b")
          .setDisabled(disabled)
      );
    }
    rows.push(actionRow);
  }

  // Row 4: Cash Out button
  const mult = calcMultiplier(game.mineCount, game.gemsFound);
  const winnings = Math.floor(game.bet * mult);
  const cashOutRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`mines_cashout_${game.userId}`)
      .setLabel(
        game.gemsFound > 0
          ? `Cash Out — ${formatNumber(winnings)} gems (${mult}x)`
          : "Cash Out"
      )
      .setEmoji("💰")
      .setStyle(ButtonStyle.Success)
      .setDisabled(game.status === "done" || game.gemsFound === 0)
  );
  rows.push(cashOutRow);

  return rows;
}

// ── Build the embed ───────────────────────────────────────────────────────────
function buildEmbed(
  game: MinesGame,
  result?: "cashout" | "exploded"
): EmbedBuilder {
  const mult = calcMultiplier(game.mineCount, game.gemsFound);
  const potential = Math.floor(game.bet * mult);

  const colors: Record<string, number> = {
    cashout: 0x57f287,
    exploded: 0xed4245,
  };
  const color = result ? colors[result] : 0x5865f2;

  const titles: Record<string, string> = {
    cashout: "💰 Mines — Cashed Out!",
    exploded: "💣 Mines — BOOM!",
  };
  const title = result ? titles[result] : "💣 Mines";

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: "💰 Bet", value: `${formatNumber(game.bet)} gems`, inline: true },
      { name: "💣 Mines", value: `${game.mineCount}`, inline: true },
      { name: "💎 Gems Found", value: `${game.gemsFound}`, inline: true }
    )
    .setTimestamp();

  if (result === "cashout") {
    embed.setDescription(
      `You cashed out at **${mult}x** for **${formatNumber(potential)} gems**! Smart move. 💰`
    );
    embed.addFields({ name: "✅ Payout", value: `+${formatNumber(potential)} gems`, inline: true });
  } else if (result === "exploded") {
    embed.setDescription(`You hit a mine after finding **${game.gemsFound}** gem(s). Better luck next time! 💥`);
    embed.addFields({ name: "❌ Lost", value: `-${formatNumber(game.bet)} gems`, inline: true });
  } else {
    embed.setDescription(
      game.gemsFound > 0
        ? `**${game.gemsFound}** gem(s) found! Current payout: **${formatNumber(potential)} gems (${mult}x)**\nKeep going or cash out!`
        : `Find gems without hitting a mine. Cash out anytime to keep your winnings!`
    );
  }

  return embed;
}

// ── /mines command ────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("mines")
  .setDescription("Play Mines — reveal gems without hitting a bomb!")
  .addIntegerOption((opt) =>
    opt
      .setName("bet")
      .setDescription("Amount of gems to bet")
      .setRequired(true)
      .setMinValue(100)
  )
  .addIntegerOption((opt) =>
    opt
      .setName("mines")
      .setDescription("Number of mines on the board (1–15, default 3)")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(15)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  if (games.has(userId)) {
    await interaction.reply({
      content: "You already have an active mines game! Finish it first.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const bet = interaction.options.getInteger("bet", true);
  const mineCount = interaction.options.getInteger("mines") ?? 3;

  const dbUser = await getOrCreateUser(userId, guildId, interaction.user.username);
  if (dbUser.credits < bet) {
    await interaction.reply({
      content: `You only have **${formatNumber(dbUser.credits)}** gems — not enough to bet **${formatNumber(bet)}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Deduct bet upfront
  await updateUser(userId, guildId, { credits: dbUser.credits - bet });

  // Place mines randomly
  const isMine = Array(20).fill(false);
  const positions = Array.from({ length: 20 }, (_, i) => i).sort(() => Math.random() - 0.5);
  for (let i = 0; i < mineCount; i++) isMine[positions[i]] = true;

  const game: MinesGame = {
    board: Array(20).fill("hidden") as TileState[],
    isMine,
    bet,
    mineCount,
    gemsFound: 0,
    userId,
    guildId,
    status: "playing",
  };
  games.set(userId, game);

  await interaction.reply({
    embeds: [buildEmbed(game)],
    components: buildComponents(game),
  });
}

// ── Button handler ─────────────────────────────────────────────────────────────
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const { customId, user } = interaction;
  const game = games.get(user.id);

  if (!game || game.status === "done") {
    await interaction.reply({
      content: "No active mines game. Start one with `/mines`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (game.userId !== user.id) {
    await interaction.reply({ content: "This isn't your game!", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();

  // ── CASH OUT ──────────────────────────────────────────────────────────────
  if (customId.startsWith("mines_cashout_")) {
    if (game.gemsFound === 0) return;

    const mult = calcMultiplier(game.mineCount, game.gemsFound);
    const payout = Math.floor(game.bet * mult);
    game.status = "done";
    games.delete(user.id);

    const dbUser = await getOrCreateUser(user.id, game.guildId, "");
    await updateUser(user.id, game.guildId, { credits: dbUser.credits + payout });

    await interaction.editReply({
      embeds: [buildEmbed(game, "cashout")],
      components: buildComponents(game, true),
    });
    return;
  }

  // ── TILE CLICK ────────────────────────────────────────────────────────────
  if (customId.startsWith("mines_tile_")) {
    const parts = customId.split("_");
    const idx = parseInt(parts[parts.length - 1]);

    if (isNaN(idx) || idx < 0 || idx > 19 || game.board[idx] !== "hidden") return;

    if (game.isMine[idx]) {
      // Hit a mine!
      game.board[idx] = "mine";
      game.status = "done";
      games.delete(user.id);

      await interaction.editReply({
        embeds: [buildEmbed(game, "exploded")],
        components: buildComponents(game, true),
      });
      return;
    }

    // Safe tile
    game.board[idx] = "gem";
    game.gemsFound++;

    // Check if all safe tiles revealed (auto cash out)
    const safeTiles = 20 - game.mineCount;
    if (game.gemsFound >= safeTiles) {
      const mult = calcMultiplier(game.mineCount, game.gemsFound);
      const payout = Math.floor(game.bet * mult);
      game.status = "done";
      games.delete(user.id);

      const dbUser = await getOrCreateUser(user.id, game.guildId, "");
      await updateUser(user.id, game.guildId, { credits: dbUser.credits + payout });

      await interaction.editReply({
        embeds: [buildEmbed(game, "cashout")],
        components: buildComponents(game, true),
      });
      return;
    }

    await interaction.editReply({
      embeds: [buildEmbed(game)],
      components: buildComponents(game),
    });
    return;
  }
}
