import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import {
  getLeaderboardByGems,
  getLeaderboardByXp,
  getUserGemsRank,
  getUserRank,
  getOrCreateUser,
} from "../utils/db.js";
import { getRankForCredits, formatNumber } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("View the top 10 members on the server")
  .addStringOption((opt) =>
    opt
      .setName("type")
      .setDescription("Leaderboard type (default: gems)")
      .setRequired(false)
      .addChoices(
        { name: "💎 Gems (wallet balance)", value: "gems" },
        { name: "⭐ XP / Level", value: "xp" }
      )
  );

const MEDALS = ["🥇", "🥈", "🥉"];
const POS_EMOJI = ["4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const type    = interaction.options.getString("type") ?? "gems";
  const guildId = interaction.guildId!;
  const callerId = interaction.user.id;

  const isGems = type === "gems";

  const users = isGems
    ? await getLeaderboardByGems(guildId, 10)
    : await getLeaderboardByXp(guildId, 10);

  if (users.length === 0) {
    const empty = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle("💎 GEM Leaderboard")
      .setDescription("No members have earned any gems yet.\nStart chatting to climb the board!")
      .setTimestamp();
    await interaction.editReply({ embeds: [empty] });
    return;
  }

  // Build each leaderboard row
  const rows = users.map((u, i) => {
    const pos   = i < 3 ? MEDALS[i] : (POS_EMOJI[i - 3] ?? `**\`#${i + 1}\`**`);
    const tier  = getRankForCredits(u.totalCreditsEarned);
    const value = isGems
      ? `**${formatNumber(u.credits)}** 💎`
      : `**${formatNumber(u.xp)} XP** ・ Lv.${u.level}`;

    return `${pos} <@${u.userId}> ${tier.emoji} ・ ${value}`;
  });

  // Check if the caller is already in the list
  const callerInTop = users.some((u) => u.userId === callerId);
  let callerLine = "";

  if (!callerInTop) {
    const [callerDb, callerPos] = await Promise.all([
      getOrCreateUser(callerId, guildId, interaction.user.username),
      isGems ? getUserGemsRank(callerId, guildId) : getUserRank(callerId, guildId),
    ]);
    const callerTier  = getRankForCredits(callerDb.totalCreditsEarned);
    const callerValue = isGems
      ? `${formatNumber(callerDb.credits)} 💎`
      : `${formatNumber(callerDb.xp)} XP ・ Lv.${callerDb.level}`;

    callerLine = `\n\n**Your position:**\n\`#${callerPos}\` <@${callerId}> ${callerTier.emoji} ・ ${callerValue}`;
  }

  const guildName = interaction.guild?.name ?? "Server";
  const iconURL   = interaction.guild?.iconURL({ size: 64 }) ?? undefined;

  const embed = new EmbedBuilder()
    .setColor(isGems ? 0xffd700 : 0x5865f2)
    .setAuthor({ name: `${guildName} Leaderboard`, iconURL })
    .setTitle(isGems ? "💎 Top 10 — Most Gems" : "⭐ Top 10 — Most XP")
    .setDescription(rows.join("\n") + callerLine)
    .setFooter({
      text: isGems
        ? "Sorted by current wallet balance · Earn gems by chatting!"
        : "Sorted by total XP earned · Level up by chatting!",
      iconURL: interaction.user.displayAvatarURL({ size: 32 }),
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
