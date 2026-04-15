import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { RANKS, formatNumber } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("ranks")
  .setDescription("View all rank tiers and their credit requirements");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("🏆 Rank Tiers")
    .setDescription("Your rank is based on your **current wallet balance** — it goes up when you earn gems and down if you spend or lose them.")
    .addFields(
      RANKS.map((r) => ({
        name: `${r.emoji} ${r.name}`,
        value: r.minCredits === 0 ? "Starting rank" : `${formatNumber(r.minCredits)}+ gems in wallet`,
        inline: true,
      }))
    )
    .setFooter({ text: "XP also levels you up independently — use /rank to see your progress" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
