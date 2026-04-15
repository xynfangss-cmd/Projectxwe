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

// ── Card helpers ──────────────────────────────────────────────────────────────
// Card index 0-51: suitIndex*13 + faceIndex
// Faces: 0=2 … 8=10, 9=J, 10=Q, 11=K, 12=A
// Suits: 0=♠, 1=♥, 2=♦, 3=♣
const SUITS = ["♠", "♥", "♦", "♣"];
const FACES = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

function cardValue(idx: number): number {
  const fi = idx % 13;
  if (fi === 12) return 11; // Ace
  if (fi >= 9)  return 10;  // J, Q, K
  return fi + 2;            // 2–10
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

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────
// Deterministic, fast, good distribution — lets us reproduce a full shuffled
// deck from a single seed number, keeping the stateless customId design while
// guaranteeing no duplicate cards within a game.
function makePRNG(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates shuffle of a 52-card deck using the seeded PRNG
function shuffledDeck(seed: number): number[] {
  const prng = makePRNG(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Deal the next card from the deck that hasn't been used yet
function nextCard(seed: number, usedCards: number[]): number {
  const deck = shuffledDeck(seed);
  const usedSet = new Set(usedCards);
  for (const card of deck) {
    if (!usedSet.has(card)) return card;
  }
  // Extremely unlikely fallback — start a fresh deck mid-game
  return deck[usedCards.length % 52];
}

function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 30);
}

// ── CustomId encoding ─────────────────────────────────────────────────────────
// bj_{action}_{ownerId}_{pCards}_{dCards}_{bet}_{seed}
// Cards = dot-separated indices; seed = integer

function encodeCards(cards: number[]): string { return cards.join("."); }
function decodeCards(s: string): number[] { return s.split(".").map(Number); }

function bjId(
  action: "h" | "s" | "d",
  ownerId: string,
  pCards: number[],
  dCards: number[],
  bet: number,
  seed: number
) {
  return `bj_${action}_${ownerId}_${encodeCards(pCards)}_${encodeCards(dCards)}_${bet}_${seed}`;
}

interface BJState {
  action: "h" | "s" | "d";
  ownerId: string;
  pCards: number[];
  dCards: number[];
  bet: number;
  seed: number;
}

function parseBJId(customId: string): BJState | null {
  try {
    const m = customId.match(/^bj_([hsd])_(\d+)_([0-9.]+)_([0-9.]+)_(\d+)_(\d+)$/);
    if (!m) return null;
    return {
      action: m[1] as "h" | "s" | "d",
      ownerId: m[2],
      pCards: decodeCards(m[3]),
      dCards: decodeCards(m[4]),
      bet: parseInt(m[5]),
      seed: parseInt(m[6]),
    };
  } catch { return null; }
}

// ── Dealer logic ──────────────────────────────────────────────────────────────
// Dealer hits on soft 16 and below, stands on soft 17+ (standard casino rules)
function dealerPlay(dCards: number[], seed: number): number[] {
  const hand = [...dCards];
  while (handValue(hand) < 17) {
    hand.push(nextCard(seed, hand));
  }
  return hand;
}

// ── Embed builder ─────────────────────────────────────────────────────────────
type BJResult = "blackjack" | "win" | "lose" | "push" | "bust";

function buildEmbed(
  pCards: number[],
  dCards: number[],
  bet: number,
  hiding = true,
  result?: BJResult
): EmbedBuilder {
  const pTotal = handValue(pCards);
  const dTotal = handValue(dCards);

  const colorMap: Record<BJResult, number> = {
    blackjack: 0xffd700, win: 0x57f287, push: 0xfee75c, lose: 0xed4245, bust: 0xed4245,
  };
  const titleMap: Record<BJResult, string> = {
    blackjack: "🃏 Blackjack — BLACKJACK! 🎉",
    win:       "🃏 Blackjack — You Win! 🎉",
    push:      "🃏 Blackjack — Push (Tie)",
    lose:      "🃏 Blackjack — Dealer Wins",
    bust:      "🃏 Blackjack — Busted! 💥",
  };

  const color = result ? colorMap[result] : 0x5865f2;
  const title = result ? titleMap[result] : "🃏 Blackjack";

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: `Your Hand — ${pTotal}`, value: displayHand(pCards), inline: false },
      {
        name: hiding ? "Dealer Hand — ?" : `Dealer Hand — ${dTotal}`,
        value: displayHand(dCards, hiding),
        inline: false,
      }
    )
    .setFooter({ text: `Bet: ${formatNumber(bet)} gems` })
    .setTimestamp();

  if (result) {
    let net = 0;
    if (result === "blackjack") net = Math.floor(bet * 1.5);
    else if (result === "win")  net = bet;
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

// ── Buttons ───────────────────────────────────────────────────────────────────
function buildButtons(
  ownerId: string,
  pCards: number[],
  dCards: number[],
  bet: number,
  seed: number,
  disabled = false
) {
  const canDouble = pCards.length === 2 && !disabled;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(bjId("h", ownerId, pCards, dCards, bet, seed))
      .setLabel("Hit").setEmoji("➕").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(bjId("s", ownerId, pCards, dCards, bet, seed))
      .setLabel("Stand").setEmoji("✋").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(bjId("d", ownerId, pCards, dCards, bet, seed))
      .setLabel("Double Down").setEmoji("💰").setStyle(ButtonStyle.Success).setDisabled(!canDouble),
  );
}

// ── Payout ────────────────────────────────────────────────────────────────────
async function applyPayout(
  ownerId: string,
  guildId: string,
  bet: number,
  result: BJResult
): Promise<void> {
  let payout = 0;
  if (result === "blackjack") payout = bet + Math.floor(bet * 1.5); // 3:2
  else if (result === "win")  payout = bet * 2;                      // 1:1
  else if (result === "push") payout = bet;                          // return
  // bust/lose: payout = 0 (already deducted)
  if (payout > 0) {
    const dbUser = await getOrCreateUser(ownerId, guildId, "");
    await updateUser(ownerId, guildId, { credits: dbUser.credits + payout });
  }
}

// ── /blackjack command ────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("blackjack")
  .setDescription("Play blackjack with a real shuffled deck — Hit, Stand, or Double Down!")
  .addStringOption((opt) =>
    opt.setName("bet").setDescription("Amount of gems to bet (e.g. 1k, 1m, 1b, all)").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId  = interaction.user.id;
  const guildId = interaction.guildId!;
  const betStr  = interaction.options.getString("bet", true);

  const dbUser = await getOrCreateUser(userId, guildId, interaction.user.username);
  const bet = parseAmount(betStr, dbUser.credits);
  if (bet === null || bet < 1) {
    await interaction.reply({
      content: "❌ Invalid amount. Use a number like `1000`, `1k`, `1m`, `1b`, or `all`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (dbUser.credits < bet) {
    await interaction.reply({
      content: `You only have **${formatNumber(dbUser.credits)}** gems — not enough to bet **${formatNumber(bet)}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await updateUser(userId, guildId, { credits: dbUser.credits - bet });

  // Generate a fresh seeded deck for this game
  const seed = newSeed();
  const deck  = shuffledDeck(seed);

  // Deal: player gets deck[0], deck[2]; dealer gets deck[1], deck[3]
  const pCards = [deck[0], deck[2]];
  const dCards  = [deck[1], deck[3]];
  const pTotal  = handValue(pCards);

  // Natural blackjack (player 21 on first two cards)
  if (pTotal === 21) {
    const dTotal = handValue(dCards);
    // Check for push (both blackjack)
    const result: BJResult = dTotal === 21 ? "push" : "blackjack";
    await applyPayout(userId, guildId, bet, result);
    await interaction.reply({
      embeds: [buildEmbed(pCards, dCards, bet, false, result)],
      components: [buildButtons(userId, pCards, dCards, bet, seed, true)],
    });
    return;
  }

  await interaction.reply({
    embeds: [buildEmbed(pCards, dCards, bet)],
    components: [buildButtons(userId, pCards, dCards, bet, seed)],
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

  await interaction.deferUpdate();

  const { ownerId, pCards, dCards, bet, seed } = state;
  const guildId = interaction.guildId!;
  const allDealt = [...pCards, ...dCards];

  // ── HIT ──────────────────────────────────────────────────────────────────
  if (state.action === "h") {
    const newCard   = nextCard(seed, allDealt);
    const newPCards = [...pCards, newCard];
    const pTotal    = handValue(newPCards);

    if (pTotal > 21) {
      await applyPayout(ownerId, guildId, bet, "bust");
      await interaction.editReply({
        embeds: [buildEmbed(newPCards, dCards, bet, false, "bust")],
        components: [buildButtons(ownerId, newPCards, dCards, bet, seed, true)],
      });
      return;
    }

    if (pTotal === 21) {
      // Auto-stand at 21
      const finalDealer = dealerPlay(dCards, seed);
      const dTotal = handValue(finalDealer);
      const result: BJResult = dTotal > 21 || pTotal > dTotal ? "win" : pTotal < dTotal ? "lose" : "push";
      await applyPayout(ownerId, guildId, bet, result);
      await interaction.editReply({
        embeds: [buildEmbed(newPCards, finalDealer, bet, false, result)],
        components: [buildButtons(ownerId, newPCards, finalDealer, bet, seed, true)],
      });
      return;
    }

    await interaction.editReply({
      embeds: [buildEmbed(newPCards, dCards, bet)],
      components: [buildButtons(ownerId, newPCards, dCards, bet, seed)],
    });
    return;
  }

  // ── STAND ─────────────────────────────────────────────────────────────────
  if (state.action === "s") {
    const finalDealer = dealerPlay(dCards, seed);
    const pTotal = handValue(pCards);
    const dTotal = handValue(finalDealer);

    const result: BJResult = dTotal > 21 || pTotal > dTotal ? "win" : pTotal < dTotal ? "lose" : "push";
    await applyPayout(ownerId, guildId, bet, result);
    await interaction.editReply({
      embeds: [buildEmbed(pCards, finalDealer, bet, false, result)],
      components: [buildButtons(ownerId, pCards, finalDealer, bet, seed, true)],
    });
    return;
  }

  // ── DOUBLE DOWN ───────────────────────────────────────────────────────────
  if (state.action === "d") {
    if (pCards.length !== 2) return; // only on first two cards

    const dbUser = await getOrCreateUser(ownerId, guildId, "");
    if (dbUser.credits < bet) {
      await interaction.followUp({
        content: `Not enough gems to double down — you need **${formatNumber(bet)}** more.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await updateUser(ownerId, guildId, { credits: dbUser.credits - bet });
    const doubleBet = bet * 2;

    const newCard   = nextCard(seed, allDealt);
    const newPCards = [...pCards, newCard];
    const pTotal    = handValue(newPCards);

    if (pTotal > 21) {
      await applyPayout(ownerId, guildId, doubleBet, "bust");
      await interaction.editReply({
        embeds: [buildEmbed(newPCards, dCards, doubleBet, false, "bust")],
        components: [buildButtons(ownerId, newPCards, dCards, doubleBet, seed, true)],
      });
      return;
    }

    const finalDealer = dealerPlay(dCards, seed);
    const dTotal = handValue(finalDealer);
    const result: BJResult = dTotal > 21 || pTotal > dTotal ? "win" : pTotal < dTotal ? "lose" : "push";
    await applyPayout(ownerId, guildId, doubleBet, result);
    await interaction.editReply({
      embeds: [buildEmbed(newPCards, finalDealer, doubleBet, false, result)],
      components: [buildButtons(ownerId, newPCards, finalDealer, doubleBet, seed, true)],
    });
    return;
  }
}
