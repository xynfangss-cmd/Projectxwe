import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import {
  getOrCreateUser,
  updateUser,
  addCredits,
  addXp,
  getOrCreateGuildSettings,
  updateGuildSettings,
} from "../utils/db.js";
import { getRankForCredits, RANKS, formatNumber } from "../utils/constants.js";

import { isAdmin } from "../utils/perms.js";

export const data = new SlashCommandBuilder()
  .setName("admin")
  .setDescription("Admin commands")
  .addSubcommand((sub) =>
    sub
      .setName("addcredits")
      .setDescription("Give a user gems")
      .addUserOption((opt) => opt.setName("user").setDescription("Target user").setRequired(true))
      .addIntegerOption((opt) => opt.setName("amount").setDescription("Amount").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName("removecredits")
      .setDescription("Remove gems from a user")
      .addUserOption((opt) => opt.setName("user").setDescription("Target user").setRequired(true))
      .addIntegerOption((opt) => opt.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1))
  )
  .addSubcommand((sub) =>
    sub
      .setName("addxp")
      .setDescription("Give a user XP")
      .addUserOption((opt) => opt.setName("user").setDescription("Target user").setRequired(true))
      .addIntegerOption((opt) => opt.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1))
  )
  .addSubcommand((sub) =>
    sub
      .setName("reset")
      .setDescription("Reset a user's economy data")
      .addUserOption((opt) => opt.setName("user").setDescription("Target user").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName("setup")
      .setDescription("Configure bot channels for this server")
      .addChannelOption((opt) => opt.setName("credits_channel").setDescription("Channel for credit notifications").setRequired(false))
      .addChannelOption((opt) => opt.setName("levelup_channel").setDescription("Channel for level-up announcements").setRequired(false))
      .addChannelOption((opt) => opt.setName("giveaway_channel").setDescription("Default giveaway channel").setRequired(false))
      .addNumberOption((opt) => opt.setName("xp_multiplier").setDescription("XP multiplier (e.g. 2.0 = double XP)").setRequired(false).setMinValue(0.1).setMaxValue(10))
      .addNumberOption((opt) => opt.setName("credits_multiplier").setDescription("Credits multiplier").setRequired(false).setMinValue(0.1).setMaxValue(10))
  )
  .addSubcommand((sub) =>
    sub.setName("serverinfo").setDescription("View current server configuration")
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: "You don't have permission to use admin commands.", flags: MessageFlags.Ephemeral });
    return;
  }

  try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;

  if (sub === "addcredits") {
    const target = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);
    const user = await addCredits(target.id, guildId, amount);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x57f287)
        .setTitle("✅ Credits Added")
        .addFields(
          { name: "User", value: `<@${target.id}>`, inline: true },
          { name: "Amount", value: `${formatNumber(amount)}`, inline: true },
          { name: "New Balance", value: `${formatNumber(user.credits)}`, inline: true }
        ).setTimestamp()]
    });
  }

  if (sub === "removecredits") {
    const target = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);
    const user = await getOrCreateUser(target.id, guildId);
    const newCredits = Math.max(0, user.credits - amount);
    await updateUser(target.id, guildId, { credits: newCredits });
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xfee75c)
        .setTitle("Credits Removed")
        .addFields(
          { name: "User", value: `<@${target.id}>`, inline: true },
          { name: "Removed", value: `${formatNumber(Math.min(amount, user.credits))}`, inline: true },
          { name: "New Balance", value: `${formatNumber(newCredits)}`, inline: true }
        ).setTimestamp()]
    });
  }

  if (sub === "addxp") {
    const target = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);
    const user = await addXp(target.id, guildId, amount);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x57f287)
        .setTitle("✅ XP Added")
        .addFields(
          { name: "User", value: `<@${target.id}>`, inline: true },
          { name: "XP Added", value: `${formatNumber(amount)}`, inline: true },
          { name: "New XP", value: `${formatNumber(user.xp)}`, inline: true }
        ).setTimestamp()]
    });
  }

  if (sub === "reset") {
    const target = interaction.options.getUser("user", true);
    await updateUser(target.id, guildId, {
      credits: 0,
      xp: 0,
      level: 1,
      rank: "Member",
      totalCreditsEarned: 0,
      messageCount: 0,
      dailyStreak: 0,
    });
    await interaction.editReply({ content: `Reset economy data for <@${target.id}>.` });
  }

  if (sub === "setup") {
    const creditsChannel = interaction.options.getChannel("credits_channel");
    const levelupChannel = interaction.options.getChannel("levelup_channel");
    const giveawayChannel = interaction.options.getChannel("giveaway_channel");
    const xpMult = interaction.options.getNumber("xp_multiplier");
    const creditsMult = interaction.options.getNumber("credits_multiplier");

    const updates: Record<string, unknown> = {};
    if (creditsChannel) updates.creditsChannelId = creditsChannel.id;
    if (levelupChannel) updates.levelUpChannelId = levelupChannel.id;
    if (giveawayChannel) updates.giveawayChannelId = giveawayChannel.id;
    if (xpMult != null) updates.xpMultiplier = xpMult;
    if (creditsMult != null) updates.creditsMultiplier = creditsMult;

    await updateGuildSettings(guildId, updates as Parameters<typeof updateGuildSettings>[1]);

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("✅ Server Configuration Updated")
      .setTimestamp();

    const setupFields = [
      creditsChannel ? { name: "Credits Channel", value: `<#${creditsChannel.id}>`, inline: true } : null,
      levelupChannel ? { name: "Level-up Channel", value: `<#${levelupChannel.id}>`, inline: true } : null,
      giveawayChannel ? { name: "Giveaway Channel", value: `<#${giveawayChannel.id}>`, inline: true } : null,
      xpMult != null ? { name: "XP Multiplier", value: `${xpMult}x`, inline: true } : null,
      creditsMult != null ? { name: "Credits Multiplier", value: `${creditsMult}x`, inline: true } : null,
    ].filter((f): f is { name: string; value: string; inline: boolean } => f !== null);
    if (setupFields.length > 0) embed.addFields(...setupFields);
    await interaction.editReply({ embeds: [embed] });
  }

  if (sub === "serverinfo") {
    const settings = await getOrCreateGuildSettings(guildId);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Server Configuration")
      .addFields(
        { name: "Credits Channel", value: settings.creditsChannelId ? `<#${settings.creditsChannelId}>` : "Not set", inline: true },
        { name: "Level-up Channel", value: settings.levelUpChannelId ? `<#${settings.levelUpChannelId}>` : "Not set", inline: true },
        { name: "Giveaway Channel", value: settings.giveawayChannelId ? `<#${settings.giveawayChannelId}>` : "Not set", inline: true },
        { name: "XP Multiplier", value: `${settings.xpMultiplier}x`, inline: true },
        { name: "Credits Multiplier", value: `${settings.creditsMultiplier}x`, inline: true },
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }
}
