import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
} from "discord.js";
import { getOrCreateUser, getUserRank } from "../utils/db.js";
import {
  getRankForCredits,
  progressBar,
  formatNumber,
  xpForLevel,
  RANKS,
} from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("rank")
  .setDescription("View your rank, credits, XP, and progress")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("Check another user's rank").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const target = interaction.options.getUser("user") ?? interaction.user;
  const guildId = interaction.guildId!;

  const user = await getOrCreateUser(target.id, guildId, target.username);
  const currentRank = getRankForCredits(user.totalCreditsEarned);
  const rankIndex = RANKS.findIndex((r) => r.name === currentRank.name);
  const nextRank = rankIndex < RANKS.length - 1 ? RANKS[rankIndex + 1] : null;

  const leaderboardPos = await getUserRank(target.id, guildId);
  const xpNeeded = xpForLevel(user.level + 1);
  const xpProgress = progressBar(user.xp % xpNeeded, xpNeeded);

  const creditsToNext = nextRank
    ? nextRank.minCredits - user.totalCreditsEarned
    : 0;
  const creditsProgress = nextRank
    ? progressBar(
        user.totalCreditsEarned - currentRank.minCredits,
        nextRank.minCredits - currentRank.minCredits
      )
    : progressBar(1, 1);

  const member = interaction.guild?.members.cache.get(target.id) as GuildMember | undefined;
  const avatarUrl = target.displayAvatarURL({ size: 128 });

  const embed = new EmbedBuilder()
    .setColor(currentRank.color as number)
    .setAuthor({ name: target.username, iconURL: avatarUrl })
    .setTitle(`${currentRank.emoji} ${currentRank.name}`)
    .setThumbnail(avatarUrl)
    .addFields(
      {
        name: "Credits",
        value: `💰 **${formatNumber(user.credits)}** in wallet`,
        inline: true,
      },
      {
        name: "Total Earned",
        value: `📈 **${formatNumber(user.totalCreditsEarned)}**`,
        inline: true,
      },
      {
        name: "Leaderboard",
        value: `🏅 **#${leaderboardPos}** on server`,
        inline: true,
      },
      {
        name: "Level Progress",
        value: `⭐ Level **${user.level}** → ${user.level + 1}\n\`${xpProgress}\` ${formatNumber(user.xp % xpNeeded)}/${formatNumber(xpNeeded)} XP`,
        inline: false,
      },
      {
        name: nextRank ? `Rank Progress → ${nextRank.emoji} ${nextRank.name}` : "Max Rank Achieved",
        value: nextRank
          ? `\`${creditsProgress}\` ${formatNumber(Math.max(0, creditsToNext))} credits to next rank`
          : `You've reached the highest rank!`,
        inline: false,
      },
      {
        name: "XP Balance",
        value: `🌟 **${formatNumber(user.xp)} XP** total`,
        inline: true,
      },
      {
        name: "Messages Sent",
        value: `💬 **${formatNumber(user.messageCount)}**`,
        inline: true,
      },
      {
        name: "Daily Streak",
        value: `🔥 **${user.dailyStreak}** day${user.dailyStreak !== 1 ? "s" : ""}`,
        inline: true,
      }
    )
    .setFooter({ text: `Use /chest to spend XP on mystery chests!` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
