import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { getOrCreateUser } from "../utils/db.js";
import { formatNumber, getRankForCredits, RANKS } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("balance")
  .setDescription("Check your gem balance and rank progress")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("Check another user's balance").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const target = interaction.options.getUser("user") ?? interaction.user;
  const guildId = interaction.guildId!;

  const user = await getOrCreateUser(target.id, guildId, target.username);

  const rank = getRankForCredits(user.totalCreditsEarned);
  const rankIndex = [...RANKS].findIndex(r => r.name === rank.name);
  const nextRank = rankIndex < RANKS.length - 1 ? RANKS[rankIndex + 1] : null;

  let nextRankValue: string;
  if (!nextRank) {
    nextRankValue = "👑 **MAX RANK ACHIEVED**";
  } else {
    const needed = nextRank.minCredits - user.totalCreditsEarned;
    nextRankValue = `${nextRank.emoji} **${nextRank.name}**\n${formatNumber(needed)} gems to go`;
  }

  const embed = new EmbedBuilder()
    .setColor(rank.color as number)
    .setTitle(`💼 ${target.username}'s Balance`)
    .setThumbnail(target.displayAvatarURL({ size: 64 }))
    .addFields(
      { name: "Wallet", value: `💰 **${formatNumber(user.credits)}** gems`, inline: true },
      { name: "Next Rank", value: nextRankValue, inline: true },
      { name: "Total Earned", value: `💎 **${formatNumber(user.totalCreditsEarned)}** gems`, inline: true },
      { name: "XP", value: `🌟 ${formatNumber(user.xp)} XP`, inline: true },
      { name: "Rank", value: `${rank.emoji} ${rank.name}`, inline: true },
      { name: "Level", value: `⭐ Level ${user.level}`, inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
