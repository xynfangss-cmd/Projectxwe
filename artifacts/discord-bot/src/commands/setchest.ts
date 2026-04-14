import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { CHEST_COST_XP, CHEST_REWARDS } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("setchest")
  .setDescription("Post a permanent chest panel in this channel so members can open chests")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }

  const rewardLines = CHEST_REWARDS.map((r) => {
    const value =
      r.minCredits > 0
        ? `${r.emoji} **${r.type}** — up to ${r.maxCredits.toLocaleString()} gems`
        : `${r.emoji} **${r.type}** — +${r.xp} XP`;
    return value;
  });

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("🎁 Mystery Chest")
    .setDescription(
      [
        `Spend **${CHEST_COST_XP} XP** to crack open a mystery chest and win a random reward!`,
        "",
        "**Possible Rewards:**",
        rewardLines.join("\n"),
        "",
        `> 💡 Earn XP by chatting — every **10,000 gems** earned gives you **100 XP**.`,
      ].join("\n")
    )
    .setFooter({ text: `Cost: ${CHEST_COST_XP} XP per chest · Results are private` })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("chest_open")
      .setLabel(`Open Chest — ${CHEST_COST_XP} XP`)
      .setEmoji("🎁")
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.channel!.send({ embeds: [embed], components: [row] });

  await interaction.editReply({ content: "✅ Chest panel posted! Members can now click the button to open chests." });
}
