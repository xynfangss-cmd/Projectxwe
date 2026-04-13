import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";
import { createCode } from "../utils/db.js";
import { formatNumber } from "../utils/constants.js";

function randomCode(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export const data = new SlashCommandBuilder()
  .setName("createcode")
  .setDescription("Create a redeemable gem code")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addIntegerOption((opt) =>
    opt.setName("gems").setDescription("How many gems this code gives").setRequired(true).setMinValue(1)
  )
  .addIntegerOption((opt) =>
    opt.setName("uses").setDescription("How many times this code can be used").setRequired(true).setMinValue(1)
  )
  .addStringOption((opt) =>
    opt.setName("code").setDescription("Custom code text (auto-generated if left blank)").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const gems    = interaction.options.getInteger("gems", true);
  const uses    = interaction.options.getInteger("uses", true);
  const custom  = interaction.options.getString("code");
  const guildId = interaction.guildId!;

  const code = custom ? custom.toUpperCase().replace(/\s+/g, "-") : randomCode();

  const created = await createCode(guildId, code, gems, uses, interaction.user.id);

  if (!created) {
    await interaction.editReply({ content: `❌ The code **${code}** already exists. Choose a different one.` });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("✅ Code Created")
    .addFields(
      { name: "Code",     value: `\`${created.code}\``,              inline: true },
      { name: "Reward",   value: `${formatNumber(gems)} gems 💎`,     inline: true },
      { name: "Max Uses", value: `${uses}`,                           inline: true },
    )
    .setFooter({ text: `Created by ${interaction.user.username} · Members can redeem with /redeem` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
