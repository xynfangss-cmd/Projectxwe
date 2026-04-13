import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { getOrCreateUser, updateUser, logTransaction } from "../utils/db.js";
import { formatNumber, parseAmount } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("transfer")
  .setDescription("Transfer gems to another user")
  .addUserOption((opt) => opt.setName("user").setDescription("User to transfer to").setRequired(true))
  .addStringOption((opt) =>
    opt.setName("amount").setDescription("Amount of gems to transfer (e.g. 1k, 5m, 100)").setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName("note").setDescription("Optional note").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const target = interaction.options.getUser("user", true);
  const amountRaw = interaction.options.getString("amount", true);
  const amount    = parseAmount(amountRaw);
  if (!amount || amount < 1) {
    await interaction.editReply({ content: "❌ Invalid amount. Use e.g. `500`, `10k`, `5m`." });
    return;
  }
  const note = interaction.options.getString("note") ?? undefined;
  const guildId = interaction.guildId!;
  const fromId = interaction.user.id;

  if (target.bot) {
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Cannot Transfer to Bots").setTimestamp()] });
  }
  if (target.id === fromId) {
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Cannot Transfer to Yourself").setTimestamp()] });
  }

  const [fromUser, toUser] = await Promise.all([
    getOrCreateUser(fromId, guildId, interaction.user.username),
    getOrCreateUser(target.id, guildId, target.username),
  ]);

  if (fromUser.credits < amount) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Insufficient Credits").setDescription(`You only have **${formatNumber(fromUser.credits)}** gems.`).setTimestamp()],
    });
  }

  await Promise.all([
    updateUser(fromId, guildId, { credits: fromUser.credits - amount }),
    updateUser(target.id, guildId, { credits: toUser.credits + amount }),
    logTransaction(guildId, target.id, amount, "gems", "transfer", fromId, note),
  ]);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("💸 Transfer Complete")
    .addFields(
      { name: "From", value: `<@${fromId}>`, inline: true },
      { name: "To", value: `<@${target.id}>`, inline: true },
      { name: "Amount", value: `💰 **${formatNumber(amount)} gems**`, inline: true },
    );

  if (note) embed.addFields({ name: "Note", value: note, inline: false });
  embed.setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
