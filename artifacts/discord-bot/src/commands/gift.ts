import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { getOrCreateUser, updateUser } from "../utils/db.js";
import { formatNumber, parseAmount } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("gift")
  .setDescription("Gift gems to another member from your balance")
  .addUserOption((opt) =>
    opt.setName("member").setDescription("The member to gift gems to").setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("How many gems to gift (e.g. 1k, 1m, 1b, all)").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const target    = interaction.options.getUser("member", true);
  const amountStr = interaction.options.getString("amount", true);
  const guildId   = interaction.guildId!;
  const sender    = interaction.user;

  if (target.id === sender.id) {
    await interaction.editReply({ content: "❌ You can't gift gems to yourself!" });
    return;
  }
  if (target.bot) {
    await interaction.editReply({ content: "❌ You can't gift gems to a bot!" });
    return;
  }

  const [senderUser, targetUser] = await Promise.all([
    getOrCreateUser(sender.id, guildId, sender.username),
    getOrCreateUser(target.id, guildId, target.username),
  ]);

  const amount = parseAmount(amountStr, senderUser.credits);
  if (amount === null || amount < 1) {
    await interaction.editReply({ content: "❌ Invalid amount. Use a number like `1000`, `1k`, `1m`, `1b`, or `all`." });
    return;
  }

  if (senderUser.credits < amount) {
    await interaction.editReply({
      content: `❌ You only have **${formatNumber(senderUser.credits)} gems** — you need **${formatNumber(amount)}**.`,
    });
    return;
  }

  await Promise.all([
    updateUser(sender.id, guildId, { credits: senderUser.credits - amount }),
    updateUser(target.id, guildId, { credits: targetUser.credits + amount }),
  ]);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("💝 Gems Gifted!")
    .setDescription(`<@${sender.id}> gifted **${formatNumber(amount)} gems** to <@${target.id}>!`)
    .addFields(
      {
        name: `${sender.username}'s New Balance`,
        value: `💎 ${formatNumber(senderUser.credits - amount)}`,
        inline: true,
      },
      {
        name: `${target.username}'s New Balance`,
        value: `💎 ${formatNumber(targetUser.credits + amount)}`,
        inline: true,
      },
    )
    .setFooter({ text: "Use /balance to check your wallet" })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
