import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { getOrCreateUser, getOrCreateBankAccount } from "../utils/db.js";
import { formatNumber, getRankForCredits } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("balance")
  .setDescription("Check your wallet and bank balance")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("Check another user's balance").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const target = interaction.options.getUser("user") ?? interaction.user;
  const guildId = interaction.guildId!;

  const [user, bank] = await Promise.all([
    getOrCreateUser(target.id, guildId, target.username),
    getOrCreateBankAccount(target.id, guildId),
  ]);

  const rank = getRankForCredits(user.totalCreditsEarned);
  const total = user.credits + bank.balance;

  const embed = new EmbedBuilder()
    .setColor(rank.color as number)
    .setTitle(`💼 ${target.username}'s Balance`)
    .setThumbnail(target.displayAvatarURL({ size: 64 }))
    .addFields(
      { name: "Wallet", value: `💰 **${formatNumber(user.credits)}** gems`, inline: true },
      { name: "Bank", value: `🏦 **${formatNumber(bank.balance)}** gems`, inline: true },
      { name: "Total", value: `💎 **${formatNumber(total)}** gems`, inline: true },
      { name: "XP", value: `🌟 ${formatNumber(user.xp)} XP`, inline: true },
      { name: "Rank", value: `${rank.emoji} ${rank.name}`, inline: true },
      { name: "Level", value: `⭐ Level ${user.level}`, inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
