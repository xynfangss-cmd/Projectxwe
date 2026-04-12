import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";
import { getOrCreateUser, updateUser, logChestReward } from "../utils/db.js";
import {
  CHEST_COST_XP,
  CHEST_REWARDS,
  weightedRandom,
  formatNumber,
} from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("chest")
  .setDescription(`Open a mystery chest for ${CHEST_COST_XP} XP and win rewards!`);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  const user = await getOrCreateUser(userId, guildId, interaction.user.username);

  if (user.xp < CHEST_COST_XP) {
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("❌ Not Enough XP")
      .setDescription(
        `You need **${CHEST_COST_XP} XP** to open a chest.\nYou currently have **${formatNumber(user.xp)} XP**.\n\nEarn more XP by chatting — every 10,000 gems earns you 100 XP!`
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  const preview = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("🎁 Mystery Chest")
    .setDescription(
      `You have **${formatNumber(user.xp)} XP**. A chest costs **${CHEST_COST_XP} XP**.\n\nClick **Open Chest** to spend ${CHEST_COST_XP} XP!`
    )
    .addFields({
      name: "Possible Rewards",
      value: CHEST_REWARDS.map((r) => `${r.emoji} **${r.type}**`).join("\n"),
    })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("open_chest").setLabel(`Open Chest (${CHEST_COST_XP} XP)`).setStyle(ButtonStyle.Primary).setEmoji("🎁"),
    new ButtonBuilder().setCustomId("cancel_chest").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );

  const msg = await interaction.editReply({ embeds: [preview], components: [row] });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 30_000,
    filter: (i) => i.user.id === userId,
  });

  collector.on("collect", async (btnInt) => {
    collector.stop();
    if (btnInt.customId === "cancel_chest") {
      await btnInt.update({
        embeds: [new EmbedBuilder().setColor(0x99aab5).setTitle("Chest Opening Cancelled").setTimestamp()],
        components: [],
      });
      return;
    }

    // Re-fetch user in case state changed
    const freshUser = await getOrCreateUser(userId, guildId);
    if (freshUser.xp < CHEST_COST_XP) {
      await btnInt.update({
        embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Not Enough XP").setDescription("You don't have enough XP anymore.").setTimestamp()],
        components: [],
      });
      return;
    }

    const reward = weightedRandom(CHEST_REWARDS);
    const creditsWon = reward.minCredits > 0
      ? Math.floor(Math.random() * (reward.maxCredits - reward.minCredits + 1)) + reward.minCredits
      : 0;
    const xpWon = reward.xp ?? 0;

    // Deduct XP, add rewards
    let newXp = freshUser.xp - CHEST_COST_XP + xpWon;
    let newCredits = freshUser.credits + creditsWon;
    await updateUser(userId, guildId, { xp: newXp, credits: newCredits });
    await logChestReward(userId, guildId, reward.type, creditsWon + xpWon, CHEST_COST_XP);

    const rewardDesc =
      creditsWon > 0
        ? `**+${formatNumber(creditsWon)} gems**`
        : `**+${formatNumber(xpWon)} XP**`;

    const resultEmbed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(`${reward.emoji} ${reward.type}!`)
      .setDescription(`You opened the mystery chest and won:\n\n${rewardDesc}`)
      .addFields(
        { name: "XP Remaining", value: `🌟 ${formatNumber(newXp)} XP`, inline: true },
        { name: "Credits", value: `💰 ${formatNumber(newCredits)}`, inline: true }
      )
      .setFooter({ text: `You spent ${CHEST_COST_XP} XP` })
      .setTimestamp();

    await btnInt.update({ embeds: [resultEmbed], components: [] });
  });

  collector.on("end", async (_, reason) => {
    if (reason === "time") {
      await interaction.editReply({ components: [] }).catch(() => {});
    }
  });
}
