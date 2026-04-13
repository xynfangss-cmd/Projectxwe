import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("tickets")
  .setDescription("Open a support ticket");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎫 Support Tickets")
    .setDescription(
      [
        "Need help? Select the type of ticket below and a private channel will be created for you.",
        "",
        "🛡️ **Staff Report** — Report a staff member",
        "🚨 **Scam Report** — Report a scam or suspicious activity",
        "❓ **General Help** — Any other questions or issues",
      ].join("\n")
    )
    .setFooter({ text: "Only you and staff can see your ticket" })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_staff_report")
      .setLabel("Staff Report")
      .setEmoji("🛡️")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("ticket_scam_report")
      .setLabel("Scam Report")
      .setEmoji("🚨")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ticket_general_help")
      .setLabel("General Help")
      .setEmoji("❓")
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({ embeds: [embed], components: [row] });
}
