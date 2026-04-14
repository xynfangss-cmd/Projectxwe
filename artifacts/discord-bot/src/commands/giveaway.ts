import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";
import {
  createGiveaway,
  getActiveGiveaways,
  getGiveaway,
  updateGiveaway,
  getOrCreateUser,
  updateUser,
} from "../utils/db.js";
import { formatNumber } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("giveaway")
  .setDescription("Giveaway management")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("Start a new giveaway")
      .addStringOption((opt) => opt.setName("prize").setDescription("What is the prize?").setRequired(true))
      .addIntegerOption((opt) => opt.setName("duration").setDescription("Duration in minutes").setRequired(true).setMinValue(1).setMaxValue(10080))
      .addIntegerOption((opt) => opt.setName("winners").setDescription("Number of winners").setRequired(false).setMinValue(1).setMaxValue(20))
      .addIntegerOption((opt) => opt.setName("entry_cost").setDescription("Credit cost to enter (0 = free)").setRequired(false).setMinValue(0))
      .addStringOption((opt) => opt.setName("description").setDescription("Optional description").setRequired(false))
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List active giveaways")
  )
  .addSubcommand((sub) =>
    sub.setName("end").setDescription("End a giveaway early")
      .addIntegerOption((opt) => opt.setName("id").setDescription("Giveaway ID").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName("reroll").setDescription("Reroll winners")
      .addIntegerOption((opt) => opt.setName("id").setDescription("Giveaway ID").setRequired(true))
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch { return; }
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;

  if (sub === "start") {
    const prize = interaction.options.getString("prize", true);
    const durationMins = interaction.options.getInteger("duration", true);
    const winners = interaction.options.getInteger("winners") ?? 1;
    const entryCost = interaction.options.getInteger("entry_cost") ?? 0;
    const description = interaction.options.getString("description") ?? undefined;

    const endsAt = new Date(Date.now() + durationMins * 60 * 1000);
    const channel = interaction.channel as TextChannel;

    const giveaway = await createGiveaway({
      guildId,
      channelId: channel.id,
      prize,
      description,
      winnerCount: winners,
      entryCost,
      hostedBy: interaction.user.id,
      endsAt,
      isActive: true,
      entrantsJson: [],
      winnersJson: [],
    });

    const embed = buildGiveawayEmbed(giveaway.id, prize, description, winners, entryCost, endsAt, interaction.user.id, []);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`giveaway_enter_${giveaway.id}`).setLabel(entryCost > 0 ? `Enter (${formatNumber(entryCost)} gems)` : "Enter Giveaway").setStyle(ButtonStyle.Success).setEmoji("🎉")
    );

    const msg = await channel.send({ embeds: [embed], components: [row] });
    await updateGiveaway(giveaway.id, { messageId: msg.id });

    await interaction.editReply({ content: `Giveaway started! ID: **${giveaway.id}**` });
  }

  else if (sub === "list") {
    const giveaways = await getActiveGiveaways(guildId);
    if (giveaways.length === 0) {
      await interaction.editReply({ content: "No active giveaways." });
    }
    const lines = giveaways.map((g) => `**#${g.id}** — ${g.prize} (ends <t:${Math.floor(g.endsAt.getTime() / 1000)}:R>)`);
    await interaction.editReply({ content: lines.join("\n") });
  }

  else if (sub === "end") {
    const id = interaction.options.getInteger("id", true);
    const giveaway = await getGiveaway(id);
    if (!giveaway || giveaway.guildId !== guildId) await interaction.editReply({ content: "Giveaway not found." });
    if (!giveaway.isActive) await interaction.editReply({ content: "Giveaway is already ended." });

    const winners = pickWinners(giveaway.entrantsJson as string[], giveaway.winnerCount);
    await updateGiveaway(id, { isActive: false, endedAt: new Date(), winnersJson: winners });

    const channel = interaction.guild?.channels.cache.get(giveaway.channelId) as TextChannel | undefined;
    if (channel && giveaway.messageId) {
      const endEmbed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🎉 Giveaway Ended — ${giveaway.prize}`)
        .setDescription(
          winners.length > 0
            ? `Winners: ${winners.map((w) => `<@${w}>`).join(", ")}`
            : "No winners (no entries)."
        )
        .setTimestamp();
      await channel.messages.fetch(giveaway.messageId).then((m) => m.edit({ embeds: [endEmbed], components: [] })).catch(() => {});
      if (winners.length > 0) {
        await channel.send({ content: `Congratulations to ${winners.map((w) => `<@${w}>`).join(", ")} for winning **${giveaway.prize}**! 🎉` });
      }
    }

    await interaction.editReply({ content: `Giveaway #${id} ended. Winners: ${winners.length > 0 ? winners.map((w) => `<@${w}>`).join(", ") : "none"}` });
  }

  else if (sub === "reroll") {
    const id = interaction.options.getInteger("id", true);
    const giveaway = await getGiveaway(id);
    if (!giveaway || giveaway.guildId !== guildId) await interaction.editReply({ content: "Giveaway not found." });

    const entrants = giveaway.entrantsJson as string[];
    const winners = pickWinners(entrants, giveaway.winnerCount);
    await updateGiveaway(id, { winnersJson: winners });

    const channel = interaction.guild?.channels.cache.get(giveaway.channelId) as TextChannel | undefined;
    if (channel && winners.length > 0) {
      await channel.send({ content: `Giveaway rerolled! New winners: ${winners.map((w) => `<@${w}>`).join(", ")} for **${giveaway.prize}**! 🎉` });
    }

    await interaction.editReply({ content: "Rerolled successfully!" });
  }
}

export function buildGiveawayEmbed(
  id: number,
  prize: string,
  description: string | undefined | null,
  winners: number,
  entryCost: number,
  endsAt: Date,
  hostedBy: string,
  entrants: string[]
) {
  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(`🎉 GIVEAWAY — ${prize}`)
    .addFields(
      { name: "Ends", value: `<t:${Math.floor(endsAt.getTime() / 1000)}:R>`, inline: true },
      { name: "Winners", value: `${winners}`, inline: true },
      { name: "Entry Cost", value: entryCost > 0 ? `${formatNumber(entryCost)} gems` : "Free", inline: true },
      { name: "Entries", value: `${entrants.length}`, inline: true },
      { name: "Hosted by", value: `<@${hostedBy}>`, inline: true },
      { name: "ID", value: `#${id}`, inline: true }
    )
    .setTimestamp(endsAt);

  if (description) embed.setDescription(description);
  return embed;
}

export function pickWinners(entrants: string[], count: number): string[] {
  const shuffled = [...entrants].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}
