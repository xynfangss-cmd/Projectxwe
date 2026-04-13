import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";
import { createCode } from "../utils/db.js";
import { formatNumber, parseAmount } from "../utils/constants.js";

function randomCode(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export const data = new SlashCommandBuilder()
  .setName("createcode")
  .setDescription("Create a redeemable gem code")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((opt) =>
    opt.setName("gems").setDescription("How many gems this code gives (e.g. 1k, 5m, 100m)").setRequired(true)
  )
  .addIntegerOption((opt) =>
    opt.setName("uses").setDescription("How many times this code can be used").setRequired(true).setMinValue(1)
  )
  .addStringOption((opt) =>
    opt.setName("code").setDescription("Custom code text (auto-generated if left blank)").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const gemsRaw = interaction.options.getString("gems", true);
  const gems    = parseAmount(gemsRaw);
  if (!gems || gems < 1) {
    await interaction.editReply({ content: `❌ Invalid gem amount. Use something like \`1k\`, \`50m\`, or \`100000\`.` });
    return;
  }
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
