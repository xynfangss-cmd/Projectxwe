import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { getOrCreateUser, updateUser } from "../utils/db.js";
import { DAILY_COOLDOWN_MS, formatNumber, formatTime } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily gems reward");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const user = await getOrCreateUser(userId, guildId, interaction.user.username);

  const now = Date.now();
  const lastDaily = user.lastDailyAt ? user.lastDailyAt.getTime() : 0;
  const diff = now - lastDaily;

  if (diff < DAILY_COOLDOWN_MS) {
    const remaining = DAILY_COOLDOWN_MS - diff;
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle("⏰ Daily Already Claimed")
      .setDescription(`You already claimed your daily reward!\nCome back in **${formatTime(remaining)}**.`)
      .addFields({ name: "Current Streak", value: `🔥 ${user.dailyStreak} day${user.dailyStreak !== 1 ? "s" : ""}`, inline: true })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Calculate streak
  const streakBroken = diff > DAILY_COOLDOWN_MS * 2;
  const newStreak = streakBroken ? 1 : user.dailyStreak + 1;

  // Base reward 500-1500, with streak bonus
  const base = Math.floor(Math.random() * 1_001) + 500;
  const streakBonus = Math.min(newStreak * 50, 500);
  const total = base + streakBonus;

  const newCredits = user.credits + total;
  await updateUser(userId, guildId, {
    credits: newCredits,
    totalCreditsEarned: user.totalCreditsEarned + total,
    lastDailyAt: new Date(),
    dailyStreak: newStreak,
  });

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("🎁 Daily Reward Claimed!")
    .addFields(
      { name: "Base Reward", value: `💰 ${formatNumber(base)} gems`, inline: true },
      { name: "Streak Bonus", value: `🔥 +${formatNumber(streakBonus)} gems`, inline: true },
      { name: "Total", value: `✨ **${formatNumber(total)} gems**`, inline: true },
      { name: "Streak", value: `🔥 **${newStreak}** day${newStreak !== 1 ? "s" : ""} ${newStreak >= 7 ? "🏆" : ""}`, inline: true },
      { name: "New Balance", value: `💰 ${formatNumber(newCredits)} gems`, inline: true },
    )
    .setDescription(streakBroken && user.dailyStreak > 1 ? "Your streak was reset. Come back daily to build it up!" : newStreak === 1 ? "Welcome back! Keep claiming daily to build your streak for bonus rewards!" : `Keep it up! Streak bonus increases each day!`)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
