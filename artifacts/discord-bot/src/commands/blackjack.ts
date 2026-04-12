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

// ── Card helpers ─────────────────────────────────────────────────────────────
// Card index 0-51: suitIndex*13 + faceIndex
// Faces: 0=2, 1=3, ..., 8=10, 9=J, 10=Q, 11=K, 12=A
// Suits: 0=♠, 1=♥, 2=♦, 3=♣
const SUITS = ["♠", "♥", "♦", "♣"];
const FACES = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

function cardValue(idx: number): number {
  const fi = idx % 13;
  if (fi === 12) return 11; // Ace
  if (fi >= 9) return 10;   // J, Q, K
  return fi + 2;            // 2-10
}

function cardDisplay(idx: number): string {
  return `\`${FACES[idx % 13]}${SUITS[Math.floor(idx / 13)]}\``;
}

function handValue(cards: number[]): number {
  let total = cards.reduce((a, c) => a + cardValue(c), 0);
  let aces = cards.filter((c) => c % 13 === 12).length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function displayHand(cards: number[], hideSecond = false): string {
  return cards.map((c, i) => (hideSecond && i === 1 ? "`🂠`" : cardDisplay(c))).join(" ");
}

function randomCard(): number {
  return Math.floor(Math.random() * 52);
}

function randomCards(n: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < n; i++) arr.push(randomCard());
  return arr;
}

// ── CustomId encoding ─────────────────────────────────────────────────────────
// bj_h_{ownerId}_{pCards}_{dCards}_{bet}  ← Hit button
// bj_s_{ownerId}_{pCards}_{dCards}_{bet}  ← Stand button
// bj_d_{ownerId}_{pCards}_{dCards}_{bet}  ← Double Down button
// Cards encoded as dot-separated indices (0-51)

function encodeCards(cards: number[]): string { return cards.join("."); }
function decodeCards(s: string): number[] { return s.split(".").map(Number); }

function bjId(action: "h" | "s" | "d", ownerId: string, pCards: number[], dCards: number[], bet: number) {
  return `bj_${action}_${ownerId}_${encodeCards(pCards)}_${encodeCards(dCards)}_${bet}`;
}

interface BJState {
  action: "h" | "s" | "d";
  ownerId: string;
  pCards: number[];
  dCards: number[];
  bet: number;
}

function parseBJId(customId: string): BJState | null {
  try {
    // bj_{action}_{ownerId}_{pCards}_{dCards}_{bet}
    const prefix = customId.match(/^bj_([hsd])_(\d+)_([0-9.]+)_([0-9.]+)_(\d+)$/);
    if (!prefix) return null;
    return {
      action: prefix[1] as "h" | "s" | "d",
      ownerId: prefix[2],
      pCards: decodeCards(prefix[3]),
      dCards: decodeCards(prefix[4]),
      bet: parseInt(prefix[5]),
    };
  } catch { return null; }
}

// ── Build embed ───────────────────────────────────────────────────────────────
type BJResult = "blackjack" | "win" | "lose" | "push" | "bust";

function buildEmbed(pCards: number[], dCards: number[], bet: number, hiding = true, result?: BJResult): EmbedBuilder {
  const pTotal = handValue(pCards);
  const dTotal = handValue(dCards);

  const colorMap: Record<BJResult, number> = {
    blackjack: 0xffd700, win: 0x57f287, push: 0xfee75c, lose: 0xed4245, bust: 0xed4245,
  };
  const titleMap: Record<BJResult, string> = {
    blackjack: "🃏 Blackjack — BLACKJACK! 🎉",
    win: "🃏 Blackjack — You Win!",
    push: "🃏 Blackjack — Push (Tie)",
    lose: "🃏 Blackjack — Dealer Wins",
    bust: "🃏 Blackjack — Busted! 💥",
  };

  const color = result ? colorMap[result] : 0x5865f2;
  const title = result ? titleMap[result] : "🃏 Blackjack";

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: `Your Hand — ${pTotal}`, value: displayHand(pCards), inline: false },
      { name: hiding ? "Dealer Hand — ?" : `Dealer Hand — ${dTotal}`, value: displayHand(dCards, hiding), inline: false },
    )
    .setFooter({ text: `Bet: ${formatNumber(bet)} gems` })
    .setTimestamp();

  if (result) {
    let net = 0;
    if (result === "blackjack") net = Math.floor(bet * 1.5);
    else if (result === "win") net = bet;
    else if (result === "push") net = 0;
    else net = -bet;

    embed.addFields({
      name: net > 0 ? "✅ Won" : net < 0 ? "❌ Lost" : "➡️ Returned",
      value: `${net >= 0 ? "+" : ""}${formatNumber(net)} gems`,
      inline: true,
    });
  }

  return embed;
}

// ── Build action buttons ──────────────────────────────────────────────────────
function buildButtons(ownerId: string, pCards: number[], dCards: number[], bet: number, disabled = false) {
  const canDouble = pCards.length === 2 && !disabled;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(bjId("h", ownerId, pCards, dCards, bet))
      .setLabel("Hit").setEmoji("➕").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(bjId("s", ownerId, pCards, dCards, bet))
      .setLabel("Stand").setEmoji("✋").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(bjId("d", ownerId, pCards, dCards, bet))
      .setLabel("Double Down").setEmoji("💰").setStyle(ButtonStyle.Success).setDisabled(!canDouble),
  );
}

// ── Dealer logic ──────────────────────────────────────────────────────────────
function dealerPlay(dCards: number[]): number[] {
  const hand = [...dCards];
  while (handValue(hand) < 17) hand.push(randomCard());
  return hand;
}

// ── Finish game and apply payout ──────────────────────────────────────────────
async function applyPayout(ownerId: string, guildId: string, bet: number, result: BJResult): Promise<void> {
  let payout = 0;
  if (result === "blackjack") payout = bet + Math.floor(bet * 1.5);
  else if (result === "win") payout = bet * 2;
  else if (result === "push") payout = bet;
  if (payout > 0) {
    const dbUser = await getOrCreateUser(ownerId, guildId, "");
    await updateUser(ownerId, guildId, { credits: dbUser.credits + payout });
  }
}

// ── /blackjack command ────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("blackjack")
  .setDescription("Play interactive blackjack — Hit, Stand, or Double Down!")
  .addIntegerOption((opt) =>
    opt.setName("bet").setDescription("Amount of gems to bet").setRequired(true).setMinValue(100)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const bet = interaction.options.getInteger("bet", true);

  const dbUser = await getOrCreateUser(userId, guildId, interaction.user.username);
  if (dbUser.credits < bet) {
    await interaction.reply({
      content: `You only have **${formatNumber(dbUser.credits)}** gems — not enough to bet **${formatNumber(bet)}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await updateUser(userId, guildId, { credits: dbUser.credits - bet });

  const pCards = randomCards(2);
  const dCards = randomCards(2);
  const pTotal = handValue(pCards);

  // Natural blackjack
  if (pTotal === 21) {
    await applyPayout(userId, guildId, bet, "blackjack");
    await interaction.reply({
      embeds: [buildEmbed(pCards, dCards, bet, false, "blackjack")],
      components: [buildButtons(userId, pCards, dCards, bet, true)],
    });
    return;
  }

  await interaction.reply({
    embeds: [buildEmbed(pCards, dCards, bet)],
    components: [buildButtons(userId, pCards, dCards, bet)],
  });
}

// ── Button handler ────────────────────────────────────────────────────────────
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const state = parseBJId(interaction.customId);
  if (!state) return;

  if (state.ownerId !== interaction.user.id) {
    await interaction.reply({ content: "This isn't your game!", flags: MessageFlags.Ephemeral });
    return;
  }

  // Acknowledge immediately
  await interaction.deferUpdate();

  const { ownerId, pCards, dCards, bet } = state;
  const guildId = interaction.guildId!;

  // ── HIT ──────────────────────────────────────────────────────────────────
  if (state.action === "h") {
    const newPCards = [...pCards, randomCard()];
    const pTotal = handValue(newPCards);

    if (pTotal > 21) {
      await applyPayout(ownerId, guildId, bet, "bust");
      await interaction.editReply({
        embeds: [buildEmbed(newPCards, dCards, bet, false, "bust")],
        components: [buildButtons(ownerId, newPCards, dCards, bet, true)],
      });
      return;
    }

    if (pTotal === 21) {
      // Auto-stand at 21
      const finalDealer = dealerPlay(dCards);
      const dTotal = handValue(finalDealer);
      const result: BJResult = dTotal > 21 || pTotal > dTotal ? "win" : pTotal < dTotal ? "lose" : "push";
      await applyPayout(ownerId, guildId, bet, result);
      await interaction.editReply({
        embeds: [buildEmbed(newPCards, finalDealer, bet, false, result)],
        components: [buildButtons(ownerId, newPCards, finalDealer, bet, true)],
      });
      return;
    }

    await interaction.editReply({
      embeds: [buildEmbed(newPCards, dCards, bet)],
      components: [buildButtons(ownerId, newPCards, dCards, bet)],
    });
    return;
  }

  // ── STAND ─────────────────────────────────────────────────────────────────
  if (state.action === "s") {
    const finalDealer = dealerPlay(dCards);
    const pTotal = handValue(pCards);
    const dTotal = handValue(finalDealer);

    const result: BJResult = dTotal > 21 || pTotal > dTotal ? "win" : pTotal < dTotal ? "lose" : "push";
    await applyPayout(ownerId, guildId, bet, result);
    await interaction.editReply({
      embeds: [buildEmbed(pCards, finalDealer, bet, false, result)],
      components: [buildButtons(ownerId, pCards, finalDealer, bet, true)],
    });
    return;
  }

  // ── DOUBLE DOWN ───────────────────────────────────────────────────────────
  if (state.action === "d") {
    if (pCards.length !== 2) return; // can't double after hitting

    const dbUser = await getOrCreateUser(ownerId, guildId, "");
    if (dbUser.credits < bet) {
      await interaction.followUp({
        content: `Not enough gems to double down (need ${formatNumber(bet)} more).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await updateUser(ownerId, guildId, { credits: dbUser.credits - bet });
    const doubleBet = bet * 2;

    const newPCards = [...pCards, randomCard()];
    const pTotal = handValue(newPCards);

    if (pTotal > 21) {
      await applyPayout(ownerId, guildId, doubleBet, "bust");
      await interaction.editReply({
        embeds: [buildEmbed(newPCards, dCards, doubleBet, false, "bust")],
        components: [buildButtons(ownerId, newPCards, dCards, doubleBet, true)],
      });
      return;
    }

    const finalDealer = dealerPlay(dCards);
    const dTotal = handValue(finalDealer);
    const result: BJResult = dTotal > 21 || pTotal > dTotal ? "win" : pTotal < dTotal ? "lose" : "push";
    await applyPayout(ownerId, guildId, doubleBet, result);
    await interaction.editReply({
      embeds: [buildEmbed(newPCards, finalDealer, doubleBet, false, result)],
      components: [buildButtons(ownerId, newPCards, finalDealer, doubleBet, true)],
    });
    return;
  }
}
