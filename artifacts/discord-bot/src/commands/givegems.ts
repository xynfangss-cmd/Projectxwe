import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { getOrCreateUser, updateUser } from "../utils/db.js";
import { formatNumber } from "../utils/constants.js";
import { isAdmin } from "../utils/perms.js";

export const data = new SlashCommandBuilder()
  .setName("givegems")
  .setDescription("Admin: Give gems to a member (gems are created, not taken from anyone)")
  .addUserOption((opt) =>
    opt.setName("member").setDescription("The member to give gems to").setRequired(true)
  )
  .addIntegerOption((opt) =>
    opt
      .setName("amount")
      .setDescription("How many gems to give")
      .setRequired(true)
      .setMinValue(1)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: "❌ You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const target  = interaction.options.getUser("member", true);
  const amount  = interaction.options.getInteger("amount", true);
  const guildId = interaction.guildId!;

  if (target.bot) {
    await interaction.editReply({ content: "❌ You can't give gems to a bot!" });
    return;
  }

  const targetUser = await getOrCreateUser(target.id, guildId, target.username);
  const newBalance = targetUser.credits + amount;

  await updateUser(target.id, guildId, { credits: newBalance });

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("💎 Gems Given!")
    .setDescription(
      `**${formatNumber(amount)} gems** have been added to <@${target.id}>'s wallet.`
    )
    .addFields(
      {
        name: "Previous Balance",
        value: `💎 ${formatNumber(targetUser.credits)}`,
        inline: true,
      },
      {
        name: "New Balance",
        value: `💎 ${formatNumber(newBalance)}`,
        inline: true,
      }
    )
    .setFooter({ text: `Given by ${interaction.user.username}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
