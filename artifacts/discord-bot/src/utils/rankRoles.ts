import { Guild, GuildMember, EmbedBuilder, TextChannel } from "discord.js";
import { RANKS, getRankForCredits, formatNumber } from "./constants.js";

// Find a Discord role whose name matches a rank name (case-insensitive)
function findRankRole(guild: Guild, rankName: string) {
  return guild.roles.cache.find(
    (r) => r.name.toLowerCase() === rankName.toLowerCase()
  ) ?? null;
}

/**
 * Remove all stale rank roles from a member and add the correct one.
 * Silently skips if the role doesn't exist in the guild.
 */
export async function syncMemberRankRole(
  guild: Guild,
  member: GuildMember,
  newRankName: string
): Promise<void> {
  const allRankNames = RANKS.map((r) => r.name);

  // Remove every rank role that isn't the target
  const toRemove = member.roles.cache.filter(
    (r) => allRankNames.includes(r.name) && r.name !== newRankName
  );
  for (const [, role] of toRemove) {
    await member.roles.remove(role).catch(() => {});
  }

  // Add the new rank role if the guild has it and member doesn't already have it
  const newRole = findRankRole(guild, newRankName);
  if (newRole && !member.roles.cache.has(newRole.id)) {
    await member.roles.add(newRole).catch(() => {});
  }
}

/**
 * Called whenever a user's credits change.
 * Compares old vs new rank and handles promotion or demotion.
 * Returns true if rank changed.
 */
export async function checkRankChange(
  guild: Guild,
  member: GuildMember,
  oldCredits: number,
  newCredits: number,
  notifyChannelId?: string | null
): Promise<boolean> {
  const oldRank = getRankForCredits(oldCredits);
  const newRank = getRankForCredits(newCredits);

  if (oldRank.name === newRank.name) return false;

  const promoted = RANKS.findIndex((r) => r.name === newRank.name) >
                   RANKS.findIndex((r) => r.name === oldRank.name);

  // Sync Discord roles
  await syncMemberRankRole(guild, member, newRank.name);

  // Build notification embed
  const embed = new EmbedBuilder()
    .setColor(promoted ? (newRank.color as number) : 0xed4245)
    .setTitle(promoted ? `${newRank.emoji} Rank Up!` : `${newRank.emoji} Rank Down`)
    .setDescription(
      promoted
        ? `<@${member.id}> ranked up to **${newRank.name}**! 🎉`
        : `<@${member.id}> dropped to **${newRank.name}**.`
    )
    .addFields(
      { name: promoted ? "Previous Rank" : "Lost Rank", value: `${oldRank.emoji} ${oldRank.name}`, inline: true },
      { name: "New Rank",  value: `${newRank.emoji} ${newRank.name}`, inline: true },
      { name: "Balance",   value: `💎 ${formatNumber(newCredits)}`,  inline: true },
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
    .setTimestamp();

  if (notifyChannelId) {
    const ch = guild.channels.cache.get(notifyChannelId) as TextChannel | undefined;
    await ch?.send({ embeds: [embed] }).catch(() => {});
  } else {
    // Fall back to first available text channel the bot can write to
    const fallback = guild.channels.cache.find(
      (c) => c.type === 0 && (c as TextChannel).permissionsFor(guild.members.me!)?.has("SendMessages")
    ) as TextChannel | undefined;
    await fallback?.send({ embeds: [embed] }).catch(() => {});
  }

  return true;
}
