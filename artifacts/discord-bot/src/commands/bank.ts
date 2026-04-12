import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("bank")
  .setDescription("Open the GEM Bank — check your balance or request a deposit");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🏦 GEM Bank")
    .setDescription(
      `Welcome, **${interaction.user.displayName}**!\nWhat would you like to do?`
    )
    .setFooter({ text: "Choose an option below" });

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
