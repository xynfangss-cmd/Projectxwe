import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { getLeaderboard, getLeaderboardByXp } from "../utils/db.js";
import { getRankForCredits, formatNumber } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("View the server leaderboard")
  .addStringOption((opt) =>
    opt
      .setName("type")
      .setDescription("Leaderboard type")
      .setRequired(false)
      .addChoices(
        { name: "Credits (default)", value: "credits" },
        { name: "XP / Level", value: "xp" }
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const type = interaction.options.getString("type") ?? "credits";
  const guildId = interaction.guildId!;

  const users =
    type === "xp"
      ? await getLeaderboardByXp(guildId, 10)
      : await getLeaderboard(guildId, 10);

  if (users.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🏆 Leaderboard")
      .setDescription("No users found yet. Start chatting to earn credits!")
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  const medals = ["🥇", "🥈", "🥉"];
  const lines = users.map((u, i) => {
    const medal = medals[i] ?? `**#${i + 1}**`;
    const rank = getRankForCredits(u.totalCreditsEarned);
    if (type === "xp") {
      return `${medal} <@${u.userId}> ${rank.emoji} — **${formatNumber(u.xp)} XP** (Lv.${u.level})`;
    }
    return `${medal} <@${u.userId}> ${rank.emoji} — **${formatNumber(u.totalCreditsEarned)}** credits`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(`🏆 ${type === "xp" ? "XP" : "Credits"} Leaderboard`)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `Server: ${interaction.guild?.name}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
