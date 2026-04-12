import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { RANKS, formatNumber } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("ranks")
  .setDescription("View all rank tiers and their credit requirements");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("🏆 Rank Tiers")
    .setDescription("Earn credits by chatting to climb the ranks!")
    .addFields(
      RANKS.map((r) => ({
        name: `${r.emoji} ${r.name}`,
        value: r.minCredits === 0 ? "Starting rank" : `${formatNumber(r.minCredits)}+ total credits earned`,
        inline: true,
      }))
    )
    .setFooter({ text: "XP also levels you up independently — use /rank to see your progress" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
