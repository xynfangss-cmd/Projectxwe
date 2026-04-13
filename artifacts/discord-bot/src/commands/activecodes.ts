import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";
import { getActiveCodes } from "../utils/db.js";
import { formatNumber } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("activecodes")
  .setDescription("View all active redeemable gem codes")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const codes = await getActiveCodes(interaction.guildId!);

  if (codes.length === 0) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x99aab5)
          .setTitle("🎟️ Active Codes")
          .setDescription("No active codes right now. Create one with `/createcode`.")
          .setTimestamp(),
      ],
    });
    return;
  }

  const lines = codes.map((c, i) => {
    const usesLeft = c.maxUses - c.uses;
    const bar = usesLeft > 0 ? "🟢" : "🔴";
    return (
      `${bar} \`${c.code}\` — **${formatNumber(c.reward)} gems** · ` +
      `${c.uses}/${c.maxUses} uses (${usesLeft} left)`
    );
  });

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("🎟️ Active Gem Codes")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${codes.length} active code${codes.length !== 1 ? "s" : ""} · Members redeem with /redeem` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
