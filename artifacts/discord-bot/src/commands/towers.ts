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

const ROWS = 8;
const COLS = 3;
type Difficulty = "easy" | "medium";

// Per-floor multipliers (index 0 = floor 1, index 7 = floor 8)
const MULTIPLIERS: Record<Difficulty, number[]> = {
  easy:   [1.45, 2.10, 3.05, 4.42, 6.41, 9.29, 13.47, 19.53],
  medium: [2.70, 7.29, 19.68, 53.14, 143.5, 387.4, 1046.0, 2824.0],
};

// For easy:   layout[r] = bomb column (0-2)   → 1 bomb, 2 safe
// For medium: layout[r] = safe column (0-2)   → 1 safe, 2 bombs
function generateLayout(): number[] {
  return Array.from({ length: ROWS }, () => Math.floor(Math.random() * COLS));
}

function isSafe(diff: Difficulty, layout: number[], row: number, col: number): boolean {
  return diff === "easy" ? col !== layout[row] : col === layout[row];
}

// ── Encode / decode ────────────────────────────────────────────────────────────
function encL(layout: number[]): string { return layout.join(""); }
function decL(s: string): number[]      { return s.split("").map(Number); }
function encP(picks: number[]): string  { return picks.map(p => p < 0 ? "-" : String(p)).join(""); }
function decP(s: string): number[]      { return s.split("").map(c => c === "-" ? -1 : Number(c)); }

// ── Custom ID builders ─────────────────────────────────────────────────────────
// towers_pick_{col}_{uid}_{diff}_{bet}_{layout}_{picks}_{row}
// towers_cash_{uid}_{diff}_{bet}_{layout}_{picks}_{row}
function pickId(col: number, uid: string, diff: Difficulty, bet: number, layout: number[], picks: number[], row: number) {
  return `towers_pick_${col}_${uid}_${diff}_${bet}_${encL(layout)}_${encP(picks)}_${row}`;
}
function cashId(uid: string, diff: Difficulty, bet: number, layout: number[], picks: number[], row: number) {
  return `towers_cash_${uid}_${diff}_${bet}_${encL(layout)}_${encP(picks)}_${row}`;
}

interface TowersCtx {
  uid: string; diff: Difficulty; bet: number;
  layout: number[]; picks: number[]; row: number;
  col?: number; type: "pick" | "cash";
}

function parseId(id: string): TowersCtx | null {
  try {
    const parts = id.split("_");
    if (parts[0] !== "towers") return null;

    if (parts[1] === "pick") {
      const [,, col, uid, diff, bet, layout, picks, row] = parts;
      return { type: "pick", col: Number(col), uid, diff: diff as Difficulty, bet: Number(bet), layout: decL(layout), picks: decP(picks), row: Number(row) };
    }
    if (parts[1] === "cash") {
      const [,, uid, diff, bet, layout, picks, row] = parts;
      return { type: "cash", uid, diff: diff as Difficulty, bet: Number(bet), layout: decL(layout), picks: decP(picks), row: Number(row) };
    }
    return null;
  } catch { return null; }
}

// ── Tower display ──────────────────────────────────────────────────────────────
function buildTower(diff: Difficulty, layout: number[], picks: number[], currentRow: number, state: "active" | "lost" | "cashedout"): string {
  const mults = MULTIPLIERS[diff];
  const lines: string[] = [];

  for (let r = ROWS - 1; r >= 0; r--) {
    const floorNum    = r + 1;
    const mult        = mults[r];
    const multStr     = mult >= 1000 ? `×${(mult / 1000).toFixed(1)}k` : `×${mult.toFixed(2)}`;
    const isActive    = r === currentRow && state === "active";
    const isRevealed  = r < currentRow || (r === currentRow && state !== "active");
    const prefix      = isActive ? "▶" : " ";
    const floor       = `F${String(floorNum).padStart(2, " ")}`;
    let tileStr: string;
    let suffix = "";

    if (!isRevealed) {
      tileStr = "🟦 🟦 🟦";
      suffix  = `  ${multStr}`;
    } else {
      const pick = picks[r];
      const safe = isSafe(diff, layout, r, pick);
      const tiles = ["", "", ""];

      if (safe) {
        for (let c = 0; c < COLS; c++) {
          if (c === pick)             tiles[c] = "✅";
          else if (diff === "easy")   tiles[c] = c === layout[r] ? "💣" : "⬜";
          else                        tiles[c] = "💣";
        }
        suffix = "  ✓";
      } else {
        for (let c = 0; c < COLS; c++) {
          if (c === pick)             tiles[c] = "💥";
          else if (diff === "easy")   tiles[c] = "⬜";
          else                        tiles[c] = c === layout[r] ? "⬜" : "💣";
        }
        suffix = "  💥";
      }
      tileStr = tiles.join(" ");
    }

    lines.push(`${prefix} ${floor} │ ${tileStr} │${suffix}`);
  }

  return `\`\`\`\n${lines.join("\n")}\n\`\`\``;
}

// ── Build action rows ──────────────────────────────────────────────────────────
function buildButtons(uid: string, diff: Difficulty, bet: number, layout: number[], picks: number[], row: number, disabled = false): ActionRowBuilder<ButtonBuilder>[] {
  const pickRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pickId(0, uid, diff, bet, layout, picks, row))
      .setLabel("Left")
      .setEmoji("⬅️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(pickId(1, uid, diff, bet, layout, picks, row))
      .setLabel("Middle")
      .setEmoji("⬆️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(pickId(2, uid, diff, bet, layout, picks, row))
      .setLabel("Right")
      .setEmoji("➡️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(cashId(uid, diff, bet, layout, picks, row))
      .setLabel(row > 0 ? "Cash Out" : "Cash Out")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled || row === 0),
  );
  return [pickRow];
}

// ── Embed builder ──────────────────────────────────────────────────────────────
function buildEmbed(
  diff: Difficulty, layout: number[], picks: number[],
  currentRow: number, bet: number,
  state: "active" | "lost" | "cashedout",
  username: string,
): EmbedBuilder {
  const mults = MULTIPLIERS[diff];
  const completedRows = state === "active" ? currentRow : (state === "lost" ? currentRow : currentRow);
  const currentMult   = completedRows > 0 ? mults[completedRows - 1] : 1.0;
  const currentWin    = Math.floor(bet * currentMult);
  const nextMult      = currentRow < ROWS ? mults[currentRow] : mults[ROWS - 1];

  const diffLabel     = diff === "easy" ? "🟢 Easy" : "🔴 Medium";
  const diffDetail    = diff === "easy" ? "1 bomb per floor" : "2 bombs per floor";

  let color = 0x5865f2;
  let title = `🗼 Towers — ${diffLabel}`;
  let statusLine = "";

  if (state === "active") {
    color = 0x5865f2;
    statusLine = currentRow === 0
      ? `Choose your tile on **Floor 1** to begin!`
      : `Floor ${currentRow} cleared! Keep climbing or cash out.`;
  } else if (state === "lost") {
    color = 0xed4245;
    title = "🗼 Towers — 💥 Boom!";
    statusLine = `You hit a bomb on Floor ${currentRow + 1} and lost **${formatNumber(bet)} gems**.`;
  } else {
    color = 0x57f287;
    title = "🗼 Towers — 💰 Cashed Out!";
    statusLine = `Cashed out at Floor ${currentRow} for **${formatNumber(currentWin)} gems**! (+${formatNumber(currentWin - bet)})`;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(buildTower(diff, layout, picks, currentRow, state))
    .addFields(
      { name: "💰 Bet",        value: `${formatNumber(bet)} gems`,     inline: true },
      { name: "📊 Difficulty", value: `${diffLabel}\n${diffDetail}`,   inline: true },
      { name: "🏆 Floor",      value: `${currentRow} / ${ROWS}`,       inline: true },
    );

  if (state === "active" && currentRow > 0) {
    embed.addFields(
      { name: "💵 Cash Out Now", value: `${formatNumber(currentWin)} gems (${currentMult.toFixed(2)}×)`, inline: true },
      { name: "⬆️ Next Floor",  value: `${formatNumber(Math.floor(bet * nextMult))} gems (${nextMult.toFixed(2)}×)`, inline: true },
    );
  }

  embed
    .setFooter({ text: `${username} • Towers${state === "active" ? " • Click a tile to climb!" : ""}` })
    .setTimestamp();

  return embed;
}

// ── Slash command ──────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("towers")
  .setDescription("Climb the tower — pick safe tiles to multiply your bet each floor")
  .addStringOption(opt =>
    opt.setName("amount").setDescription("Gems to bet (e.g. 1k, 1m, 1b, all)").setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName("difficulty")
      .setDescription("Game difficulty")
      .setRequired(false)
      .addChoices(
        { name: "🟢 Easy — 1 bomb per floor (×1.45 per floor)", value: "easy" },
        { name: "🔴 Medium — 2 bombs per floor (×2.70 per floor)", value: "medium" },
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const guildId   = interaction.guildId!;
  const userId    = interaction.user.id;
  const username  = interaction.user.username;
  const amountStr = interaction.options.getString("amount", true);
  const diff      = (interaction.options.getString("difficulty") ?? "easy") as Difficulty;

  const user   = await getOrCreateUser(userId, guildId, username);
  const amount = parseAmount(amountStr, user.credits);

  if (amount === null || amount < 1) {
    await interaction.editReply({ content: "❌ Invalid amount. Use something like `1k`, `1m`, `1b`, or `all`." });
    return;
  }
  if (user.credits < amount) {
    await interaction.editReply({ content: `❌ You only have **${formatNumber(user.credits)} gems**.` });
    return;
  }

  // Deduct bet immediately
  await updateUser(userId, guildId, { credits: user.credits - amount });

  const layout = generateLayout();
  const picks  = Array(ROWS).fill(-1);
  const row    = 0;

  const embed   = buildEmbed(diff, layout, picks, row, amount, "active", username);
  const buttons = buildButtons(userId, diff, amount, layout, picks, row);

  await interaction.editReply({ embeds: [embed], components: buttons });
}

// ── Button handler ─────────────────────────────────────────────────────────────
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  try { await interaction.deferUpdate(); } catch { return; }

  const ctx = parseId(interaction.customId);
  if (!ctx) return;

  // Only the game owner can interact
  if (interaction.user.id !== ctx.uid) {
    await interaction.followUp({ content: "❌ This is not your game!", flags: MessageFlags.Ephemeral });
    return;
  }

  const guildId  = interaction.guildId!;
  const username = interaction.user.username;
  const { uid, diff, bet, layout, picks, row } = ctx;

  // ── Cash out ──────────────────────────────────────────────────────────────
  if (ctx.type === "cash") {
    if (row === 0) return; // can't cash out before picking anything
    const mult    = MULTIPLIERS[diff][row - 1];
    const winAmt  = Math.floor(bet * mult);

    const user = await getOrCreateUser(uid, guildId, username);
    await updateUser(uid, guildId, { credits: user.credits + winAmt });

    const embed   = buildEmbed(diff, layout, picks, row, bet, "cashedout", username);
    const buttons = buildButtons(uid, diff, bet, layout, picks, row, true);
    await interaction.editReply({ embeds: [embed], components: buttons });
    return;
  }

  // ── Tile pick ─────────────────────────────────────────────────────────────
  const col       = ctx.col!;
  const newPicks  = [...picks];
  newPicks[row]   = col;
  const safe      = isSafe(diff, layout, row, col);

  if (!safe) {
    // Lost — bet already deducted, nothing to refund
    const embed   = buildEmbed(diff, layout, newPicks, row, bet, "lost", username);
    const buttons = buildButtons(uid, diff, bet, layout, newPicks, row, true);
    await interaction.editReply({ embeds: [embed], components: buttons });
    return;
  }

  const nextRow = row + 1;

  // Reached the top — auto cash out
  if (nextRow >= ROWS) {
    const mult   = MULTIPLIERS[diff][ROWS - 1];
    const winAmt = Math.floor(bet * mult);

    const user = await getOrCreateUser(uid, guildId, username);
    await updateUser(uid, guildId, { credits: user.credits + winAmt });

    const embed   = buildEmbed(diff, layout, newPicks, nextRow, bet, "cashedout", username);
    const buttons = buildButtons(uid, diff, bet, layout, newPicks, nextRow, true);
    await interaction.editReply({ embeds: [embed], components: buttons });
    return;
  }

  // Safe pick — go to next floor
  const embed   = buildEmbed(diff, layout, newPicks, nextRow, bet, "active", username);
  const buttons = buildButtons(uid, diff, bet, layout, newPicks, nextRow);
  await interaction.editReply({ embeds: [embed], components: buttons });
}
