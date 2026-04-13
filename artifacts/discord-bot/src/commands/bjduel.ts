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
import { db } from "@workspace/db";
import { discordDuels } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateUser, updateUser } from "../utils/db.js";
import { formatNumber } from "../utils/constants.js";

// ── Types ────────────────────────────────────────────────────────────────────
type DuelStatus = "pending" | "challenger_turn" | "opponent_turn" | "done";

interface DuelGame {
  gameId: string;
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
  expiresAt: Date;
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function saveGame(game: DuelGame): Promise<void> {
  await db
    .insert(discordDuels)
    .values({
      gameId:             game.gameId,
      guildId:            game.guildId,
      channelId:          game.channelId,
      challengerId:       game.challengerId,
      opponentId:         game.opponentId,
      challengerUsername: game.challengerUsername,
      opponentUsername:   game.opponentUsername,
      bet:                game.bet,
      deck:               game.deck,
      challengerHand:     game.challengerHand,
      opponentHand:       game.opponentHand,
      status:             game.status,
      expiresAt:          game.expiresAt,
    })
    .onConflictDoUpdate({
      target: discordDuels.gameId,
      set: {
        deck:           game.deck,
        challengerHand: game.challengerHand,
        opponentHand:   game.opponentHand,
        status:         game.status,
      },
    });
}

async function loadGame(gameId: string): Promise<DuelGame | null> {
  const [row] = await db
    .select()
    .from(discordDuels)
    .where(eq(discordDuels.gameId, gameId))
    .limit(1);

  if (!row) return null;

  return {
    gameId:             row.gameId,
    guildId:            row.guildId,
    channelId:          row.channelId,
    challengerId:       row.challengerId,
    opponentId:         row.opponentId,
    challengerUsername: row.challengerUsername,
    opponentUsername:   row.opponentUsername,
    bet:                row.bet,
    deck:               row.deck as string[],
    challengerHand:     row.challengerHand as string[],
    opponentHand:       row.opponentHand as string[],
    status:             row.status as DuelStatus,
    expiresAt:          row.expiresAt,
  };
}

async function deleteGame(gameId: string): Promise<void> {
  await db.delete(discordDuels).where(eq(discordDuels.gameId, gameId));
}

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
function parseCustomId(customId: string): { action: string; gameId: string } {
  const without = customId.slice("bjduel_".length);
  const idx = without.indexOf("_");
  return { action: without.slice(0, idx), gameId: without.slice(idx + 1) };
}

// ── Embeds ────────────────────────────────────────────────────────────────────
function pendingEmbed(game: DuelGame): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🃏 Blackjack Duel Challenge!")
    .setDescription(
      `<@${game.challengerId}> has challenged <@${game.opponentId}> to a **Blackjack Duel**!\n\n` +
      `💎 **Wager:** ${formatNumber(game.bet)} gems each — winner takes **${formatNumber(game.bet * 2)}**!\n\n` +
      `<@${game.opponentId}>, do you accept?`
    )
    .setFooter({ text: "Challenge expires in 2 minutes" })
    .setTimestamp();
}

function gameEmbed(game: DuelGame, title: string, color: number): EmbedBuilder {
  const turn =
    game.status === "challenger_turn"
      ? `🎯 It's **${game.challengerUsername}'s** turn!`
      : `🎯 It's **${game.opponentUsername}'s** turn!`;

  const opponentDisplay =
    game.status === "challenger_turn"
      ? `${game.opponentHand[0]}  🂠  **(?)** `
      : handStr(game.opponentHand);

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(turn)
    .addFields(
      { name: `🃏 ${game.challengerUsername}'s Hand`, value: handStr(game.challengerHand), inline: false },
      { name: `🃏 ${game.opponentUsername}'s Hand`,   value: opponentDisplay,              inline: false },
      { name: "💎 Wager",      value: `${formatNumber(game.bet)} gems each`, inline: true },
      { name: "🏆 Prize Pool", value: `${formatNumber(game.bet * 2)} gems`,  inline: true },
    )
    .setTimestamp();
}

function resultEmbed(game: DuelGame, winnerId: string | null): EmbedBuilder {
  const cTotal = handTotal(game.challengerHand);
  const oTotal = handTotal(game.opponentHand);

  const description =
    winnerId === null
      ? `It's a **tie**! Both players keep their gems.`
      : winnerId === game.challengerId
      ? `🏆 **${game.challengerUsername}** wins **${formatNumber(game.bet * 2)} gems**!`
      : `🏆 **${game.opponentUsername}** wins **${formatNumber(game.bet * 2)} gems**!`;

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
      { name: "💎 Wager",     value: `${formatNumber(game.bet)} each`,  inline: true },
      { name: "🏆 Total Pot", value: `${formatNumber(game.bet * 2)}`,   inline: true },
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

// ── Resolve & pay out ─────────────────────────────────────────────────────────
async function resolveGame(game: DuelGame): Promise<string | null> {
  const cTotal = handTotal(game.challengerHand);
  const oTotal = handTotal(game.opponentHand);

  let winnerId: string | null = null;
  if      (cTotal > 21 && oTotal > 21) winnerId = null;
  else if (cTotal > 21)                winnerId = game.opponentId;
  else if (oTotal > 21)                winnerId = game.challengerId;
  else if (cTotal > oTotal)            winnerId = game.challengerId;
  else if (oTotal > cTotal)            winnerId = game.opponentId;
  else                                 winnerId = null;

  const [cUser, oUser] = await Promise.all([
    getOrCreateUser(game.challengerId, game.guildId, game.challengerUsername),
    getOrCreateUser(game.opponentId,   game.guildId, game.opponentUsername),
  ]);

  if (winnerId === game.challengerId) {
    await updateUser(game.challengerId, game.guildId, { credits: cUser.credits + game.bet * 2 });
  } else if (winnerId === game.opponentId) {
    await updateUser(game.opponentId, game.guildId, { credits: oUser.credits + game.bet * 2 });
  } else {
    await Promise.all([
      updateUser(game.challengerId, game.guildId, { credits: cUser.credits + game.bet }),
      updateUser(game.opponentId,   game.guildId, { credits: oUser.credits + game.bet }),
    ]);
  }

  await deleteGame(game.gameId);
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

  // Hold challenger's bet immediately
  await updateUser(challenger.id, guildId, { credits: cUser.credits - bet });

  const gameId    = newGameId();
  const seed      = Date.now() ^ Math.floor(Math.random() * 0xffffffff);
  const deck      = shuffleDeck(seed);
  const cHand     = [deck.shift()!, deck.shift()!];
  const oHand     = [deck.shift()!, deck.shift()!];
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000);

  const game: DuelGame = {
    gameId,
    guildId,
    channelId:          interaction.channelId,
    challengerId:       challenger.id,
    opponentId:         opponent.id,
    challengerUsername: challenger.username,
    opponentUsername:   opponent.username,
    bet,
    deck,
    challengerHand: cHand,
    opponentHand:   oHand,
    status: "pending",
    expiresAt,
  };

  // Persist to DB so it survives bot restarts
  await saveGame(game);

  await interaction.editReply({
    content: `<@${opponent.id}>`,
    embeds: [pendingEmbed(game)],
    components: [pendingRow(gameId)],
  });

  // Auto-expire after 2 minutes
  setTimeout(async () => {
    const current = await loadGame(gameId);
    if (!current || current.status !== "pending") return;

    await deleteGame(gameId);
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

  // ── Accept ───────────────────────────────────────────────────────────────────
  if (action === "accept") {
    // Fast checks before any DB work
    const game = await loadGame(gameId);

    if (!game) {
      await interaction.reply({ content: "❌ This duel has expired or no longer exists.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (Date.now() > game.expiresAt.getTime()) {
      await deleteGame(gameId);
      await interaction.reply({ content: "❌ This duel has expired.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.status !== "pending") {
      await interaction.reply({ content: "❌ This duel is already in progress.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.user.id !== game.opponentId) {
      await interaction.reply({ content: "❌ This duel isn't for you.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferUpdate();

    const oUser = await getOrCreateUser(game.opponentId, game.guildId, game.opponentUsername);
    if (oUser.credits < game.bet) {
      // Refund challenger and cancel
      const cUser = await getOrCreateUser(game.challengerId, game.guildId, game.challengerUsername);
      await updateUser(game.challengerId, game.guildId, { credits: cUser.credits + game.bet });
      await deleteGame(gameId);

      await interaction.editReply({
        content: "",
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("❌ Duel Cancelled")
            .setDescription(`<@${game.opponentId}> doesn't have enough gems to match the wager. <@${game.challengerId}>'s gems have been refunded.`)
            .setTimestamp(),
        ],
        components: [],
      });
      return;
    }

    await updateUser(game.opponentId, game.guildId, { credits: oUser.credits - game.bet });
    game.status = "challenger_turn";
    await saveGame(game);

    await interaction.editReply({
      content: `<@${game.challengerId}>`,
      embeds: [gameEmbed(game, "🃏 Blackjack Duel — In Progress", 0x5865f2)],
      components: [playRow(gameId)],
    });
    return;
  }

  // ── Decline ───────────────────────────────────────────────────────────────────
  if (action === "decline") {
    const game = await loadGame(gameId);

    if (!game) {
      await interaction.reply({ content: "❌ This duel has already expired.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.user.id !== game.opponentId) {
      await interaction.reply({ content: "❌ Only the challenged player can decline.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferUpdate();

    await deleteGame(gameId);
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

  // ── Hit / Stand — load game from DB ──────────────────────────────────────────
  const game = await loadGame(gameId);

  if (!game || game.status === "done") {
    await interaction.reply({ content: "❌ This duel no longer exists or has already ended.", flags: MessageFlags.Ephemeral });
    return;
  }

  const isChallenger = interaction.user.id === game.challengerId;
  const isOpponent   = interaction.user.id === game.opponentId;

  if (!isChallenger && !isOpponent) {
    await interaction.reply({ content: "❌ You are not part of this duel.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (game.status === "challenger_turn" && !isChallenger) {
    await interaction.reply({ content: `❌ It's **${game.challengerUsername}'s** turn, not yours!`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (game.status === "opponent_turn" && !isOpponent) {
    await interaction.reply({ content: `❌ It's **${game.opponentUsername}'s** turn, not yours!`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();

  // ── Hit ───────────────────────────────────────────────────────────────────────
  if (action === "hit") {
    const card = game.deck.shift()!;

    if (game.status === "challenger_turn") {
      game.challengerHand.push(card);
      const total = handTotal(game.challengerHand);

      if (total >= 21) {
        game.status = "opponent_turn";
        await saveGame(game);
        await interaction.editReply({
          content: `<@${game.opponentId}>`,
          embeds: [gameEmbed(game, "🃏 Blackjack Duel — In Progress", 0x5865f2)],
          components: [playRow(gameId)],
        });
      } else {
        await saveGame(game);
        await interaction.editReply({
          content: `<@${game.challengerId}>`,
          embeds: [gameEmbed(game, "🃏 Blackjack Duel — In Progress", 0x5865f2)],
          components: [playRow(gameId)],
        });
      }
    } else {
      game.opponentHand.push(card);
      const total = handTotal(game.opponentHand);

      if (total >= 21) {
        game.status = "done";
        await saveGame(game);
        const winnerId = await resolveGame(game);
        await interaction.editReply({ content: "", embeds: [resultEmbed(game, winnerId)], components: [] });
      } else {
        await saveGame(game);
        await interaction.editReply({
          content: `<@${game.opponentId}>`,
          embeds: [gameEmbed(game, "🃏 Blackjack Duel — In Progress", 0x5865f2)],
          components: [playRow(gameId)],
        });
      }
    }
    return;
  }

  // ── Stand ─────────────────────────────────────────────────────────────────────
  if (action === "stand") {
    if (game.status === "challenger_turn") {
      game.status = "opponent_turn";
      await saveGame(game);
      await interaction.editReply({
        content: `<@${game.opponentId}>`,
        embeds: [gameEmbed(game, "🃏 Blackjack Duel — In Progress", 0x5865f2)],
        components: [playRow(gameId)],
      });
    } else {
      game.status = "done";
      await saveGame(game);
      const winnerId = await resolveGame(game);
      await interaction.editReply({ content: "", embeds: [resultEmbed(game, winnerId)], components: [] });
    }
    return;
  }
}
