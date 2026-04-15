import { Client, Message, EmbedBuilder, TextChannel } from "discord.js";
import {
  getOrCreateUser,
  updateUser,
  getOrCreateGuildSettings,
  addCredits,
  getGuildRoleRewards,
} from "../utils/db.js";
import {
  CREDITS_PER_MESSAGE_MIN,
  CREDITS_PER_MESSAGE_MAX,
  MESSAGE_COOLDOWN_MS,
  getRankForCredits,
  RANKS,
  formatNumber,
  xpForLevel,
} from "../utils/constants.js";

const cooldowns = new Map<string, number>();

export async function handleMessage(client: Client, message: Message) {
  if (message.author.bot) return;
  if (!message.guild) return;

  const key = `${message.author.id}:${message.guild.id}`;
  const now = Date.now();
  const last = cooldowns.get(key) ?? 0;
  if (now - last < MESSAGE_COOLDOWN_MS) return;
  cooldowns.set(key, now);

  const settings = await getOrCreateGuildSettings(message.guild.id);

  // Check no-XP channels
  if (settings.noXpChannels?.includes(message.channel.id)) return;

  // Check no-XP roles
  if (settings.noXpRoles && settings.noXpRoles.length > 0) {
    const member = message.member;
    if (member && member.roles.cache.some((r) => settings.noXpRoles!.includes(r.id))) return;
  }

  const creditsEarned = Math.floor(
    (Math.random() * (CREDITS_PER_MESSAGE_MAX - CREDITS_PER_MESSAGE_MIN + 1) + CREDITS_PER_MESSAGE_MIN) *
      settings.creditsMultiplier
  );

  const prevUser = await getOrCreateUser(message.author.id, message.guild.id, message.author.username);
  const prevRank = getRankForCredits(prevUser.credits);
  const prevLevel = prevUser.level;

  const updatedUser = await addCredits(message.author.id, message.guild.id, creditsEarned);
  await updateUser(message.author.id, message.guild.id, {
    messageCount: updatedUser.messageCount + 1,
    lastMessageAt: new Date(),
  });

  const newRank = getRankForCredits(updatedUser.credits);

  // Rank change notification + role assignment (handles both rank-up AND rank-down)
  if (newRank.name !== prevRank.name) {
    const isPromotion = RANKS.findIndex(r => r.name === newRank.name) > RANKS.findIndex(r => r.name === prevRank.name);

    try {
      const member = message.member ?? await message.guild.members.fetch(message.author.id);
      const roleRewards = await getGuildRoleRewards(message.guild.id);
      const newRoleReward = roleRewards.find(r => r.rankName === newRank.name);
      const oldRoleReward = roleRewards.find(r => r.rankName === prevRank.name);

      if (oldRoleReward) {
        await member.roles.remove(oldRoleReward.roleId).catch(() => {});
      }
      if (newRoleReward) {
        await member.roles.add(newRoleReward.roleId).catch(() => {});
      }
    } catch {}

    const rankEmbed = new EmbedBuilder()
      .setColor(newRank.color as number)
      .setTitle(isPromotion ? `${newRank.emoji} Rank Up!` : `${newRank.emoji} Rank Changed`)
      .setDescription(
        isPromotion
          ? `<@${message.author.id}> has ranked up to **${newRank.name}**!`
          : `<@${message.author.id}>'s rank has changed to **${newRank.name}**.`
      )
      .addFields(
        { name: isPromotion ? "New Rank" : "Current Rank", value: `${newRank.emoji} ${newRank.name}`, inline: true },
        { name: "Wallet Balance", value: formatNumber(updatedUser.credits), inline: true }
      )
      .setThumbnail(message.author.displayAvatarURL({ size: 64 }))
      .setTimestamp();

    const channelId = settings.creditsChannelId ?? settings.levelUpChannelId;
    if (channelId) {
      const ch = message.guild.channels.cache.get(channelId) as TextChannel | undefined;
      await ch?.send({ embeds: [rankEmbed] }).catch(() => {});
    } else {
      if ("send" in message.channel) {
        await (message.channel as TextChannel).send({ embeds: [rankEmbed] }).catch(() => {});
      }
    }
  }

  // Level-up notification
  if (updatedUser.level > prevLevel) {
    const levelEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("⭐ Level Up!")
      .setDescription(`<@${message.author.id}> reached **Level ${updatedUser.level}**!`)
      .addFields(
        { name: "Level", value: `${prevLevel} → ${updatedUser.level}`, inline: true },
        { name: "Total XP", value: formatNumber(updatedUser.xp), inline: true }
      )
      .setTimestamp();

    const channelId = settings.levelUpChannelId ?? settings.creditsChannelId;
    if (channelId) {
      const ch = message.guild.channels.cache.get(channelId) as TextChannel | undefined;
      await ch?.send({ embeds: [levelEmbed] }).catch(() => {});
    }
  }
}
