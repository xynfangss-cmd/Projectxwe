import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { BANK_INTEREST_RATE, BANK_MAX_BALANCE, formatNumber } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("bank")
  .setDescription("Open the GEM Bank — view rules, interest info, and manage your account");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const interestPct = (BANK_INTEREST_RATE * 100).toFixed(0);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🏦 GEM Bank")
    .setDescription(
      "The official GEM Bank. Store your gems safely, earn interest, and request deposits from staff."
    )
    .addFields(
      {
        name: "📋 Bank Rules",
        value: [
          "• Only gems deposited by staff count toward your bank balance",
          "• You cannot directly transfer gems from your wallet into the bank",
          "• Bank balance cannot be used for gambling — withdraw via a staff deposit ticket",
          "• Abuse of the deposit system will result in a ban",
        ].join("\n"),
        inline: false,
      },
      {
        name: "📈 Interest",
        value: [
          `• Bank balances earn **${interestPct}% interest** periodically`,
          `• Maximum bank balance: **${formatNumber(BANK_MAX_BALANCE)} gems**`,
          "• Interest is applied automatically — no action needed",
        ].join("\n"),
        inline: false,
      },
      {
        name: "📬 Deposit Process",
        value: [
          "1. Click **Deposit** below to open a private ticket",
          "2. A staff member will join your ticket shortly",
          "3. Let them know how much you want deposited",
          "4. Staff will manually add the gems to your bank balance",
          "5. Click **Close Ticket** once your deposit is complete",
        ].join("\n"),
        inline: false,
      },
      {
        name: "💰 Check Your Balance",
        value: "Click **Balance** below to see your current wallet, bank balance, and total gems — only visible to you.",
        inline: false,
      },
    )
    .setFooter({ text: "GEM Bank • Use the buttons below to get started" })
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

  await interaction.reply({ embeds: [embed], components: [row] });
}
