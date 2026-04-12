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
type Card = { value: number; face: string; suit: string };
type BJGame = {
  deck: Card[];
  playerHand: Card[];
  dealerHand: Card[];
  bet: number;
  userId: string;
  guildId: string;
  doubled: boolean;
  status: "playing" | "done";
};

// ── Active games (in-memory) ─────────────────────────────────────────────────
export const games = new Map<string, BJGame>();

// ── Deck helpers ─────────────────────────────────────────────────────────────
const SUITS = ["♠", "♥", "♦", "♣"];
const FACES = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const face of FACES) {
      const value =
        face === "A" ? 11 : ["J", "Q", "K"].includes(face) ? 10 : parseInt(face);
      deck.push({ value, face, suit });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function draw(deck: Card[]): Card {
  return deck.pop()!;
}

function handValue(hand: Card[]): number {
  let total = hand.reduce((a, c) => a + c.value, 0);
  let aces = hand.filter((c) => c.face === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function displayHand(hand: Card[], hideSecond = false): string {
  return hand
    .map((c, i) => (hideSecond && i === 1 ? "🂠" : `\`${c.face}${c.suit}\``) )
    .join(" ");
}

// ── Build the game embed ──────────────────────────────────────────────────────
function buildEmbed(game: BJGame, result?: "win" | "lose" | "push" | "blackjack" | "bust") {
  const pTotal = handValue(game.playerHand);
  const dTotal = handValue(game.dealerHand);
  const hiding = game.status === "playing";

  const colors: Record<string, number> = {
    blackjack: 0xffd700,
    win: 0x57f287,
    push: 0xfee75c,
    lose: 0xed4245,
    bust: 0xed4245,
  };
  const color = result ? colors[result] : 0x5865f2;

  const titles: Record<string, string> = {
    blackjack: "🃏 Blackjack — BLACKJACK! 🎉",
    win: "🃏 Blackjack — You Win!",
    push: "🃏 Blackjack — Push (Tie)",
    lose: "🃏 Blackjack — Dealer Wins",
    bust: "🃏 Blackjack — Busted!",
  };
  const title = result ? titles[result] : "🃏 Blackjack";

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      {
        name: `Your Hand (${pTotal})`,
        value: displayHand(game.playerHand),
        inline: false,
      },
      {
        name: hiding ? "Dealer Hand (?)" : `Dealer Hand (${dTotal})`,
        value: displayHand(game.dealerHand, hiding),
        inline: false,
      }
    )
    .setFooter({ text: `Bet: ${formatNumber(game.bet)} gems${game.doubled ? " (doubled)" : ""}` })
    .setTimestamp();

  if (result) {
    let net = 0;
    if (result === "blackjack") net = Math.floor(game.bet * 1.5);
    else if (result === "win") net = game.bet;
    else if (result === "push") net = 0;
    else net = -game.bet;

    embed.addFields({
      name: net > 0 ? "✅ Won" : net < 0 ? "❌ Lost" : "➡️ Returned",
      value: `${net >= 0 ? "+" : ""}${formatNumber(net)} gems`,
      inline: true,
    });
  }

  return embed;
}

// ── Action row builder ────────────────────────────────────────────────────────
function buildButtons(userId: string, canDouble: boolean, disabled = false) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bj_hit_${userId}`)
      .setLabel("Hit")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`bj_stand_${userId}`)
      .setLabel("Stand")
      .setEmoji("✋")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`bj_double_${userId}`)
      .setLabel("Double Down")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled || !canDouble)
  );
}

// ── /blackjack command ────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("blackjack")
  .setDescription("Play interactive blackjack — Hit, Stand, or Double Down!")
  .addIntegerOption((opt) =>
    opt
      .setName("bet")
      .setDescription("Amount of gems to bet")
      .setRequired(true)
      .setMinValue(100)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  if (games.has(userId)) {
    await interaction.reply({
      content: "You already have an active blackjack game! Finish it first.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const bet = interaction.options.getInteger("bet", true);
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

  const deck = buildDeck();
  const playerHand = [draw(deck), draw(deck)];
  const dealerHand = [draw(deck), draw(deck)];

  const game: BJGame = { deck, playerHand, dealerHand, bet, userId, guildId, doubled: false, status: "playing" };
  games.set(userId, game);

  const pTotal = handValue(playerHand);

  // Natural blackjack check
  if (pTotal === 21) {
    await finishGame(game, "blackjack");
    games.delete(userId);
    const embed = buildEmbed(game, "blackjack");
    await interaction.reply({ embeds: [embed], components: [buildButtons(userId, false, true)] });
    return;
  }

  const embed = buildEmbed(game);
  await interaction.reply({ embeds: [embed], components: [buildButtons(userId, true)] });
}

// ── Dealer plays out ──────────────────────────────────────────────────────────
function dealerPlay(game: BJGame): void {
  while (handValue(game.dealerHand) < 17) {
    game.dealerHand.push(draw(game.deck));
  }
}

async function finishGame(
  game: BJGame,
  outcome: "win" | "lose" | "push" | "blackjack" | "bust"
): Promise<void> {
  game.status = "done";
  let payout = 0;
  if (outcome === "blackjack") payout = game.bet + Math.floor(game.bet * 1.5);
  else if (outcome === "win") payout = game.bet * 2;
  else if (outcome === "push") payout = game.bet;
  // lose / bust: payout stays 0 (bet was already deducted)

  if (payout > 0) {
    const dbUser = await getOrCreateUser(game.userId, game.guildId, "");
    await updateUser(game.userId, game.guildId, { credits: dbUser.credits + payout });
  }
}

// ── Button handler ─────────────────────────────────────────────────────────────
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const { customId, user } = interaction;
  const game = games.get(user.id);

  if (!game || game.status === "done") {
    await interaction.reply({
      content: "No active game found. Start one with `/blackjack`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Only the owner can interact
  if (game.userId !== user.id) {
    await interaction.reply({ content: "This isn't your game!", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();

  // ── HIT ──────────────────────────────────────────────────────────────────
  if (customId.startsWith("bj_hit_")) {
    game.playerHand.push(draw(game.deck));
    const pTotal = handValue(game.playerHand);

    if (pTotal > 21) {
      await finishGame(game, "bust");
      games.delete(user.id);
      const embed = buildEmbed(game, "bust");
      await interaction.editReply({ embeds: [embed], components: [buildButtons(user.id, false, true)] });
      return;
    }

    if (pTotal === 21) {
      // Auto-stand at 21
      dealerPlay(game);
      const dTotal = handValue(game.dealerHand);
      const pTotal2 = handValue(game.playerHand);
      const outcome = dTotal > 21 || pTotal2 > dTotal ? "win" : pTotal2 < dTotal ? "lose" : "push";
      await finishGame(game, outcome);
      games.delete(user.id);
      const embed = buildEmbed(game, outcome);
      await interaction.editReply({ embeds: [embed], components: [buildButtons(user.id, false, true)] });
      return;
    }

    const embed = buildEmbed(game);
    await interaction.editReply({ embeds: [embed], components: [buildButtons(user.id, false)] });
    return;
  }

  // ── STAND ─────────────────────────────────────────────────────────────────
  if (customId.startsWith("bj_stand_")) {
    dealerPlay(game);
    const pTotal = handValue(game.playerHand);
    const dTotal = handValue(game.dealerHand);

    let outcome: "win" | "lose" | "push";
    if (dTotal > 21 || pTotal > dTotal) outcome = "win";
    else if (pTotal < dTotal) outcome = "lose";
    else outcome = "push";

    await finishGame(game, outcome);
    games.delete(user.id);
    const embed = buildEmbed(game, outcome);
    await interaction.editReply({ embeds: [embed], components: [buildButtons(user.id, false, true)] });
    return;
  }

  // ── DOUBLE DOWN ───────────────────────────────────────────────────────────
  if (customId.startsWith("bj_double_")) {
    // Check user has enough for the extra bet
    const dbUser = await getOrCreateUser(user.id, game.guildId, "");
    if (dbUser.credits < game.bet) {
      await interaction.followUp({
        content: `Not enough gems to double down (need ${formatNumber(game.bet)} more).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await updateUser(user.id, game.guildId, { credits: dbUser.credits - game.bet });
    game.bet *= 2;
    game.doubled = true;

    game.playerHand.push(draw(game.deck));
    const pTotal = handValue(game.playerHand);

    if (pTotal > 21) {
      await finishGame(game, "bust");
      games.delete(user.id);
      const embed = buildEmbed(game, "bust");
      await interaction.editReply({ embeds: [embed], components: [buildButtons(user.id, false, true)] });
      return;
    }

    // Auto-stand after double
    dealerPlay(game);
    const dTotal = handValue(game.dealerHand);

    let outcome: "win" | "lose" | "push";
    if (dTotal > 21 || pTotal > dTotal) outcome = "win";
    else if (pTotal < dTotal) outcome = "lose";
    else outcome = "push";

    await finishGame(game, outcome);
    games.delete(user.id);
    const embed = buildEmbed(game, outcome);
    await interaction.editReply({ embeds: [embed], components: [buildButtons(user.id, false, true)] });
    return;
  }
}
