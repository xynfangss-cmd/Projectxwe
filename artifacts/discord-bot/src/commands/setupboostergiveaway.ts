import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
  MessageFlags,
} from "discord.js";
import { getOrCreateGuildSettings, updateGuildSettings } from "../utils/db.js";
import { formatNumber } from "../utils/constants.js";

const PRIZE_TOTAL      = 100_000_000;
const WINNER_COUNT     = 2;
const PRIZE_PER_WINNER = PRIZE_TOTAL / WINNER_COUNT;

export const data = new SlashCommandBuilder()
  .setName("setupboostergiveaway")
  .setDescription("Configure the automatic booster giveaway channel (posts every 2 hours)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("Channel to post the booster giveaway in")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }

  const channel = interaction.options.getChannel("channel", true) as TextChannel;
  const guildId = interaction.guildId!;

  await updateGuildSettings(guildId, { boosterGiveawayChannelId: channel.id });

  const boosterRole = interaction.guild?.roles.premiumSubscriberRole;

  await interaction.editReply({
    content: [
      `✅ **Booster giveaway channel set to ${channel}!**`,
      "",
      "**What happens next:**",
      `• A giveaway for **${formatNumber(PRIZE_TOTAL)} gems** will post immediately and then every **2 hours**`,
      `• Only 💜 **Server Boosters** ${boosterRole ? `(<@&${boosterRole.id}>)` : ""} can enter`,
      `• Lasts **45 minutes** with **${WINNER_COUNT} winners** — ${formatNumber(PRIZE_PER_WINNER)} gems each`,
      "",
      "⚠️ **Restart the bot** or wait for the next cycle to begin the automatic schedule.",
    ].join("\n"),
  });
}
