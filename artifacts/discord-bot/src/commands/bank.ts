import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { getOrCreateUser, getOrCreateBankAccount } from "../utils/db.js";
import { formatNumber } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("bank")
  .setDescription("Open the bank — check your balance or request a deposit");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  const [user, bank] = await Promise.all([
    getOrCreateUser(userId, guildId, interaction.user.username),
    getOrCreateBankAccount(userId, guildId),
  ]);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🏦 GEM Bank")
    .setDescription(
      `Welcome, **${interaction.user.displayName}**!\nWhat would you like to do today?`
    )
    .addFields(
      { name: "💰 Wallet", value: `${formatNumber(user.credits)} credits`, inline: true },
      { name: "🏦 Bank", value: `${formatNumber(bank.balance)} credits`, inline: true },
    )
    .setFooter({ text: "Choose an option below" })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("bank_balance")
      .setLabel("Balance")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("bank_deposit")
      .setLabel("Deposit")
      .setEmoji("📬")
      .setStyle(ButtonStyle.Success)
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}
