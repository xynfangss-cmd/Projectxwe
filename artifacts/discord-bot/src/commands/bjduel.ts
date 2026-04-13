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

// ── Types ────────────────────────────────────────────────────────────────────
type DuelStatus = "pending" | "challenger_turn" | "opponent_turn" | "done";

interface DuelGame {
  guildId: string;
  channelId: string;
  challengerId: string;
  opponentId: string;
  challengerUsername: string;
  opponentUsername: string;
  bet: number;
  deck: string[];
  challengerHand: string[];
  opponentHand: string[];
  status: DuelStatus;
}

export const duels = new Map<string, DuelGame>();

// ── Deck helpers ─────────────────────────────────────────────────────────────
const SUITS  = ["♠", "♥", "♦", "♣"];
const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function buildDeck(): string[] {
  const deck: string[] = [];
  for (const s of SUITS) for (const v of VALUES) deck.push(`${v}${s}`);
  return deck;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffleDeck(seed: number): string[] {
  const deck = buildDeck();
  const rand = mulberry32(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(card: string): number {
  const v = card.slice(0, -1);
  if (["J", "Q", "K"].includes(v)) return 10;
  if (v === "A") return 11;
  return parseInt(v, 10);
}

function handTotal(hand: string[]): number {
  let total = 0, aces = 0;
  for (const c of hand) {
    const v = cardValue(c);
    if (v === 11) aces++;
    total += v;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function handStr(hand: string[]): string {
  return hand.join("  ") + `  **(${handTotal(hand)})**`;
}

function newGameId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── Parse customId safely ─────────────────────────────────────────────────────
// Format: bjduel_{action}_{gameId}
function parseCustomId(customId: string): { action: string; gameId: string } {
  const without = customId.slice("bjduel_".length); // e.g. "accept_abc123"
  const idx = without.indexOf("_");
  return {
    action: without.slice(0, idx),
    gameId: without.slice(idx + 1),
  };
}

// ── Embed builders ───────────────────────────────────────────────────────────
function pendingEmbed(challenger: string, opponent: string, bet: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🃏 Blackjack Duel Challenge!")
    .setDescription(
      `<@${challenger}> has challenged <@${opponent}> to a **Blackjack Duel**!\n\n` +
      `💎 **Wager:** ${formatNumber(bet)} gems each — winner takes **${formatNumber(bet * 2)}**!\n\n` +
      `<@${opponent}>, do you accept?`
    )
    .setFooter({ text: "Challenge expires in 2 minutes" })
    .setTimestamp();
}

function gameEmbed(game: DuelGame, title: string, color: number): EmbedBuilder {
  const turn =
    game.status === "challenger_turn"
      ? `🎯 It's **${game.challengerUsername}'s** turn!`
      : game.status === "opponent_turn"
      ? `🎯 It's **${game.opponentUsername}'s** turn!`
      : "";

  // Hide opponent's second card while it's still challenger's turn
  const opponentHandDisplay =
    game.status === "challenger_turn"
      ? `${game.opponentHand[0]}  🂠  **(?)** `
      : handStr(game.opponentHand);

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(turn || null)
    .addFields(
      { name: `🃏 ${game.challengerUsername}'s Hand`, value: handStr(game.challengerHand), inline: false },
      { name: `🃏 ${game.opponentUsername}'s Hand`,   value: opponentHandDisplay,           inline: false },
      { name: "💎 Wager",      value: `${formatNumber(game.bet)} gems each`, inline: true },
      { name: "🏆 Prize Pool", value: `${formatNumber(game.bet * 2)} gems`,  inline: true },
    )
    .setTimestamp();
}

function resultEmbed(game: DuelGame, winnerId: string | null): EmbedBuilder {
  const cTotal = handTotal(game.challengerHand);
  const oTotal = handTotal(game.opponentHand);

  let description: string;
  if (winnerId === null) {
    description = `It's a **tie**! Both players keep their gems.`;
  } else if (winnerId === game.challengerId) {
    description = `🏆 **${game.challengerUsername}** wins **${formatNumber(game.bet * 2)} gems**!`;
  } else {
    description = `🏆 **${game.opponentUsername}** wins **${formatNumber(game.bet * 2)} gems**!`;
  }

  return new EmbedBuilder()
    .setColor(winnerId === null ? 0xfee75c : 0x57f287)
    .setTitle("🃏 Blackjack Duel — Result")
    .setDescription(description)
    .addFields(
      {
        name: `${game.challengerUsername}'s Hand`,
        value: `${handStr(game.challengerHand)}${cTotal > 21 ? "  💥 Bust" : ""}`,
        inline: false,
      },
      {
        name: `${game.opponentUsername}'s Hand`,
        value: `${handStr(game.opponentHand)}${oTotal > 21 ? "  💥 Bust" : ""}`,
        inline: false,
      },
      { name: "💎 Wager",    value: `${formatNumber(game.bet)} each`,        inline: true },
      { name: "🏆 Total Pot", value: `${formatNumber(game.bet * 2)}`,        inline: true },
    )
    .setTimestamp();
}

// ── Button rows ───────────────────────────────────────────────────────────────
function pendingRow(gameId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`bjduel_accept_${gameId}`).setLabel("✅ Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`bjduel_decline_${gameId}`).setLabel("❌ Decline").setStyle(ButtonStyle.Danger),
  );
}

function playRow(gameId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`bjduel_hit_${gameId}`).setLabel("👊 Hit").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`bjduel_stand_${gameId}`).setLabel("✋ Stand").setStyle(ButtonStyle.Secondary),
  );
}

// ── Resolve game & pay out ────────────────────────────────────────────────────
async function resolveGame(game: DuelGame, gameId: string): Promise<string | null> {
  const cTotal = handTotal(game.challengerHand);
  const oTotal = handTotal(game.opponentHand);

  const cBust = cTotal > 21;
  const oBust = oTotal > 21;

  let winnerId: string | null = null;
  if      (cBust && oBust)       winnerId = null;
  else if (cBust)                winnerId = game.opponentId;
  else if (oBust)                winnerId = game.challengerId;
  else if (cTotal > oTotal)      winnerId = game.challengerId;
  else if (oTotal > cTotal)      winnerId = game.opponentId;
  else                           winnerId = null; // tie

  // Both bets already deducted. Winner gets pot; tie refunds both.
  const [cUser, oUser] = await Promise.all([
    getOrCreateUser(game.challengerId, game.guildId, game.challengerUsername),
    getOrCreateUser(game.opponentId,   game.guildId, game.opponentUsername),
  ]);

  if (winnerId === game.challengerId) {
    await updateUser(game.challengerId, game.guildId, { credits: cUser.credits + game.bet * 2 });
  } else if (winnerId === game.opponentId) {
    await updateUser(game.opponentId, game.guildId, { credits: oUser.credits + game.bet * 2 });
  } else {
    // tie — refund both
    await Promise.all([
      updateUser(game.challengerId, game.guildId, { credits: cUser.credits + game.bet }),
      updateUser(game.opponentId,   game.guildId, { credits: oUser.credits + game.bet }),
    ]);
  }

  duels.delete(gameId);
  return winnerId;
}

// ── Slash command ─────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("bjduel")
  .setDescription("Challenge another member to a Blackjack duel for gems")
  .addUserOption((opt) =>
    opt.setName("opponent").setDescription("The member to challenge").setRequired(true)
  )
  .addIntegerOption((opt) =>
    opt.setName("bet").setDescription("How many gems to wager").setRequired(true).setMinValue(1000)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // Acknowledge immediately to avoid Discord's 3-second timeout
  await interaction.deferReply();

  const opponent   = interaction.options.getUser("opponent", true);
  const bet        = interaction.options.getInteger("bet", true);
  const guildId    = interaction.guildId!;
  const challenger = interaction.user;

  if (opponent.id === challenger.id) {
    await interaction.editReply({ content: "❌ You can't duel yourself!" });
    return;
  }
  if (opponent.bot) {
    await interaction.editReply({ content: "❌ You can't duel a bot!" });
    return;
  }

  const cUser = await getOrCreateUser(challenger.id, guildId, challenger.username);
  if (cUser.credits < bet) {
    await interaction.editReply({
      content: `❌ You only have **${formatNumber(cUser.credits)}** gems — you need **${formatNumber(bet)}**.`,
    });
    return;
  }

  // Hold challenger's bet
  await updateUser(challenger.id, guildId, { credits: cUser.credits - bet });

  const gameId = newGameId();
  const seed   = Date.now() ^ Math.floor(Math.random() * 0xffffffff);
  const deck   = shuffleDeck(seed);

  const cHand = [deck.shift()!, deck.shift()!];
  const oHand = [deck.shift()!, deck.shift()!];

  const game: DuelGame = {
    guildId,
    channelId: interaction.channelId,
    challengerId:       challenger.id,
    opponentId:         opponent.id,
    challengerUsername: challenger.username,
    opponentUsername:   opponent.username,
    bet,
    deck,
    challengerHand: cHand,
    opponentHand:   oHand,
    status: "pending",
  };
  duels.set(gameId, game);

  await interaction.editReply({
    content: `<@${opponent.id}>`,
    embeds: [pendingEmbed(challenger.id, opponent.id, bet)],
    components: [pendingRow(gameId)],
  });

  // Auto-expire after 2 minutes
  setTimeout(async () => {
    const g = duels.get(gameId);
    if (!g || g.status !== "pending") return;
    duels.delete(gameId);

    const fresh = await getOrCreateUser(challenger.id, guildId, challenger.username);
    await updateUser(challenger.id, guildId, { credits: fresh.credits + bet });

    await interaction.editReply({
      content: "",
      embeds: [
        new EmbedBuilder()
          .setColor(0x99aab5)
          .setTitle("🃏 Duel Expired")
          .setDescription(
            `<@${opponent.id}> didn't respond in time.\n` +
            `<@${challenger.id}>'s **${formatNumber(bet)} gems** have been refunded.`
          )
          .setTimestamp(),
      ],
      components: [],
    });
  }, 2 * 60 * 1000);
}

// ── Button handler ────────────────────────────────────────────────────────────
export async function handleDuelButton(interaction: ButtonInteraction): Promise<void> {
  const { action, gameId } = parseCustomId(interaction.customId);
  const game = duels.get(gameId);

  // ── Accept ──────────────────────────────────────────────────────────────────
  if (action === "accept") {
    if (!game) {
      await interaction.reply({ content: "❌ This duel has expired or no longer exists.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.user.id !== game.opponentId) {
      await interaction.reply({ content: "❌ This duel isn't for you.", flags: MessageFlags.Ephemeral });
      return;
    }

    // Acknowledge first, THEN do DB work
    await interaction.deferUpdate();

    const oUser = await getOrCreateUser(game.opponentId, game.guildId, game.opponentUsername);
    if (oUser.credits < game.bet) {
      // Refund challenger and cancel
      const cUser = await getOrCreateUser(game.challengerId, game.guildId, game.challengerUsername);
      await updateUser(game.challengerId, game.guildId, { credits: cUser.credits + game.bet });
      duels.delete(gameId);

      await interaction.editReply({
        content: "",
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("❌ Duel Cancelled")
            .setDescription(`<@${game.opponentId}> doesn't have enough gems to match the wager. Duel cancelled and gems refunded.`)
            .setTimestamp(),
        ],
        components: [],
      });
      return;
    }

    // Deduct opponent bet and start game
    await updateUser(game.opponentId, game.guildId, { credits: oUser.credits - game.bet });
    game.status = "challenger_turn";

    await interaction.editReply({
      content: `<@${game.challengerId}>`,
      embeds: [gameEmbed(game, "🃏 Blackjack Duel — In Progress", 0x5865f2)],
      components: [playRow(gameId)],
    });
    return;
  }

  // ── Decline ─────────────────────────────────────────────────────────────────
  if (action === "decline") {
    if (!game) {
      await interaction.reply({ content: "❌ This duel has already expired.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.user.id !== game.opponentId) {
      await interaction.reply({ content: "❌ Only the challenged player can decline.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferUpdate();

    duels.delete(gameId);
    const cUser = await getOrCreateUser(game.challengerId, game.guildId, game.challengerUsername);
    await updateUser(game.challengerId, game.guildId, { credits: cUser.credits + game.bet });

    await interaction.editReply({
      content: "",
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("🃏 Duel Declined")
          .setDescription(
            `<@${game.opponentId}> declined the duel.\n` +
            `<@${game.challengerId}>'s **${formatNumber(game.bet)} gems** have been refunded.`
          )
          .setTimestamp(),
      ],
      components: [],
    });
    return;
  }

  // ── Hit & Stand — check game exists first (quick, no DB) ──────────────────
  if (!game) {
    await interaction.reply({ content: "❌ This duel no longer exists.", flags: MessageFlags.Ephemeral });
    return;
  }

  const isChallenger = interaction.user.id === game.challengerId;
  const isOpponent   = interaction.user.id === game.opponentId;

  if (!isChallenger && !isOpponent) {
    await interaction.reply({ content: "❌ You are not part of this duel.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Validate it's actually this player's turn
  if (game.status === "challenger_turn" && !isChallenger) {
    await interaction.reply({ content: `❌ It's **${game.challengerUsername}'s** turn, not yours!`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (game.status === "opponent_turn" && !isOpponent) {
    await interaction.reply({ content: `❌ It's **${game.opponentUsername}'s** turn, not yours!`, flags: MessageFlags.Ephemeral });
    return;
  }

  // Acknowledge immediately before DB work
  await interaction.deferUpdate();

  // ── Hit ───────────────────────────────────────────────────────────────────
  if (action === "hit") {
    const card = game.deck.shift()!;

    if (game.status === "challenger_turn") {
      game.challengerHand.push(card);
      const total = handTotal(game.challengerHand);

      if (total >= 21) {
        // Bust or 21 — auto-advance to opponent's turn
        game.status = "opponent_turn";
        await interaction.editReply({
          content: `<@${game.opponentId}>`,
          embeds: [gameEmbed(game, "🃏 Blackjack Duel — In Progress", 0x5865f2)],
          components: [playRow(gameId)],
        });
      } else {
        await interaction.editReply({
          content: `<@${game.challengerId}>`,
          embeds: [gameEmbed(game, "🃏 Blackjack Duel — In Progress", 0x5865f2)],
          components: [playRow(gameId)],
        });
      }
    } else if (game.status === "opponent_turn") {
      game.opponentHand.push(card);
      const total = handTotal(game.opponentHand);

      if (total >= 21) {
        game.status = "done";
        const winnerId = await resolveGame(game, gameId);
        await interaction.editReply({
          content: "",
          embeds: [resultEmbed(game, winnerId)],
          components: [],
        });
      } else {
        await interaction.editReply({
          content: `<@${game.opponentId}>`,
          embeds: [gameEmbed(game, "🃏 Blackjack Duel — In Progress", 0x5865f2)],
          components: [playRow(gameId)],
        });
      }
    }
    return;
  }

  // ── Stand ──────────────────────────────────────────────────────────────────
  if (action === "stand") {
    if (game.status === "challenger_turn") {
      game.status = "opponent_turn";
      await interaction.editReply({
        content: `<@${game.opponentId}>`,
        embeds: [gameEmbed(game, "🃏 Blackjack Duel — In Progress", 0x5865f2)],
        components: [playRow(gameId)],
      });
    } else if (game.status === "opponent_turn") {
      game.status = "done";
      const winnerId = await resolveGame(game, gameId);
      await interaction.editReply({
        content: "",
        embeds: [resultEmbed(game, winnerId)],
        components: [],
      });
    }
    return;
  }
}
