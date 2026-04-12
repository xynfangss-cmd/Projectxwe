import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("View all bot commands");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📖 Bot Commands")
    .addFields(
      {
        name: "Economy",
        value: [
          "`/balance` — Check your wallet & bank",
          "`/daily` — Claim daily gems (streak bonuses!)",
          "`/weekly` — Claim weekly bonus",
          "`/work` — Work a job for gems (1h cooldown)",
          "`/crime` — Attempt crime for bigger rewards (2h cooldown)",
          "`/transfer` — Send gems to another user",
        ].join("\n"),
        inline: false,
      },
      {
        name: "Ranking",
        value: [
          "`/rank [user]` — View rank card with progress",
          "`/ranks` — View all rank tiers",
          "`/leaderboard` — Top earners on the server",
        ].join("\n"),
        inline: false,
      },
      {
        name: "Gambling",
        value: [
          "`/gamble slots` — Spin the slot machine",
          "`/gamble coinflip` — Heads or tails?",
          "`/gamble dice` — Roll dice, 5x payout on exact match",
          "`/gamble blackjack` — Quick blackjack game",
          "`/chest` — Open a mystery chest (750 XP)",
        ].join("\n"),
        inline: false,
      },
      {
        name: "Banking",
        value: [
          "`/bank balance` — View bank account",
          "`/bank deposit` — Move gems to bank",
          "`/bank withdraw` — Withdraw from bank",
          "`/bank interest` — Collect 5% daily interest",
        ].join("\n"),
        inline: false,
      },
      {
        name: "Shop & Giveaways",
        value: [
          "`/shop view` — Browse items for sale",
          "`/shop buy <id>` — Purchase an item",
          "`/giveaway start` — Start a giveaway (admin)",
          "`/giveaway list` — View active giveaways",
        ].join("\n"),
        inline: false,
      },
    )
    .setFooter({ text: "Earn 5–25 gems per message • Every 10k gems = 100 XP" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
