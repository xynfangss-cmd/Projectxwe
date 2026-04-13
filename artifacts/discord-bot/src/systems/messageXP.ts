import { Client, Message, EmbedBuilder, TextChannel } from "discord.js";
import {
  getOrCreateUser,
  updateUser,
  getOrCreateGuildSettings,
  addCredits,
} from "../utils/db.js";
import {
  CREDITS_PER_MESSAGE_MIN,
  CREDITS_PER_MESSAGE_MAX,
  MESSAGE_COOLDOWN_MS,
  getRankForCredits,
  formatNumber,
  xpForLevel,
} from "../utils/constants.js";
import { checkRankChange } from "../utils/rankRoles.js";

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

  if (settings.noXpChannels?.includes(message.channel.id)) return;
  if (settings.noXpRoles && settings.noXpRoles.length > 0) {
    const member = message.member;
    if (member && member.roles.cache.some((r) => settings.noXpRoles!.includes(r.id))) return;
  }

  const creditsEarned = Math.floor(
    (Math.random() * (CREDITS_PER_MESSAGE_MAX - CREDITS_PER_MESSAGE_MIN + 1) + CREDITS_PER_MESSAGE_MIN) *
      settings.creditsMultiplier
  );

  const prevUser  = await getOrCreateUser(message.author.id, message.guild.id, message.author.username);
  const prevLevel = prevUser.level;

  const updatedUser = await addCredits(message.author.id, message.guild.id, creditsEarned);
  await updateUser(message.author.id, message.guild.id, {
    messageCount: updatedUser.messageCount + 1,
    lastMessageAt: new Date(),
  });

  const member = message.member ??
    await message.guild.members.fetch(message.author.id).catch(() => null);

  // Rank change (promotion or demotion) — uses current balance
  if (member) {
    const notifyChannelId = settings.creditsChannelId ?? settings.levelUpChannelId ?? null;
    await checkRankChange(
      message.guild,
      member,
      prevUser.credits,
      updatedUser.credits,
      notifyChannelId,
    ).catch(() => {});
  }

  // Level-up notification
  if (updatedUser.level > prevLevel) {
    const levelEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("⭐ Level Up!")
      .setDescription(`<@${message.author.id}> reached **Level ${updatedUser.level}**!`)
      .addFields(
        { name: "Level",    value: `${prevLevel} → ${updatedUser.level}`, inline: true },
        { name: "Total XP", value: formatNumber(updatedUser.xp),           inline: true }
      )
      .setTimestamp();

    const channelId = settings.levelUpChannelId ?? settings.creditsChannelId;
    if (channelId) {
      const ch = message.guild.channels.cache.get(channelId) as TextChannel | undefined;
      await ch?.send({ embeds: [levelEmbed] }).catch(() => {});
    }
  }
}
