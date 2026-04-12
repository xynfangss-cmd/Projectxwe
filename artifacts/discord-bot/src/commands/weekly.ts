import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { getOrCreateUser, updateUser } from "../utils/db.js";
import { WEEKLY_COOLDOWN_MS, formatNumber, formatTime } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("weekly")
  .setDescription("Claim your weekly gems bonus");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const user = await getOrCreateUser(userId, guildId, interaction.user.username);

  const now = Date.now();
  const lastWeekly = user.lastWeeklyAt ? user.lastWeeklyAt.getTime() : 0;
  const diff = now - lastWeekly;

  if (diff < WEEKLY_COOLDOWN_MS) {
    const remaining = WEEKLY_COOLDOWN_MS - diff;
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle("⏰ Weekly Already Claimed")
      .setDescription(`You already claimed your weekly bonus!\nCome back in **${formatTime(remaining)}**.`)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  const base = 5_000 + Math.floor(Math.random() * 5_001);
  const xpBonus = 250;
  const newCredits = user.credits + base;
  const newXp = user.xp + xpBonus;

  await updateUser(userId, guildId, {
    credits: newCredits,
    totalCreditsEarned: user.totalCreditsEarned + base,
    xp: newXp,
    lastWeeklyAt: new Date(),
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📅 Weekly Bonus Claimed!")
    .addFields(
      { name: "Credits", value: `💰 **${formatNumber(base)}** gems`, inline: true },
      { name: "XP Bonus", value: `🌟 **+${xpBonus} XP**`, inline: true },
      { name: "New Balance", value: `💰 ${formatNumber(newCredits)} | 🌟 ${formatNumber(newXp)} XP`, inline: false }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
