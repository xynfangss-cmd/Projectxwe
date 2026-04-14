import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
} from "discord.js";
import { postGiveaway } from "../systems/boosterGiveaway.js";
import { getOrCreateGuildSettings } from "../utils/db.js";

export const data = new SlashCommandBuilder()
  .setName("startboostergiveaway")
  .setDescription("Immediately post a booster giveaway right now")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }

  const guild   = interaction.guild!;
  const guildId = guild.id;
  const client  = interaction.client;

  // Find channel: DB config first, then auto-detect by name
  const settings  = await getOrCreateGuildSettings(guildId).catch(() => null);
  let channelId   = settings?.boosterGiveawayChannelId ?? null;

  if (!channelId) {
    const found = guild.channels.cache.find(
      (c) =>
        c.type === ChannelType.GuildText &&
        c.name.toLowerCase().replace(/[\s_]/g, "-") === "booster-giveaway"
    );
    channelId = found?.id ?? null;
  }

  if (!channelId) {
    await interaction.editReply({
      content:
        "❌ No booster giveaway channel found.\n" +
        "Create a channel named **booster-giveaway** or run `/setupboostergiveaway` to configure one.",
    });
    return;
  }

  await postGiveaway(client, guildId, channelId);

  const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
  await interaction.editReply({
    content: `✅ Booster giveaway posted in ${channel ?? `<#${channelId}>`}! It will end in **45 minutes**.`,
  });
}
