import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { getOrCreateUser, addCredits } from "../utils/db.js";
import {
  WORK_COOLDOWN_MS,
  WORK_JOBS,
  formatNumber,
  formatTime,
} from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("work")
  .setDescription("Work a job to earn gems (1 hour cooldown)");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const user = await getOrCreateUser(userId, guildId, interaction.user.username);

  const now = Date.now();
  const lastWork = user.lastWorkAt ? user.lastWorkAt.getTime() : 0;
  const diff = now - lastWork;

  if (diff < WORK_COOLDOWN_MS) {
    const remaining = WORK_COOLDOWN_MS - diff;
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle("⏰ Still Working")
      .setDescription(`You're still tired from your last shift!\nRest for **${formatTime(remaining)}** before working again.`)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  const job = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)];
  const earned = Math.floor(Math.random() * (job.maxPay - job.minPay + 1)) + job.minPay;

  await addCredits(userId, guildId, earned);
  await import("../utils/db.js").then(({ updateUser }) =>
    updateUser(userId, guildId, { lastWorkAt: new Date() })
  );

  const workMessages = [
    `You clocked in as a ${job.title} and gave it your all.`,
    `Another day, another shift as a ${job.title}.`,
    `You hustled hard as a ${job.title} today.`,
    `Your boss was impressed with your work as a ${job.title}!`,
    `You finished a long shift as a ${job.title}.`,
  ];
  const message = workMessages[Math.floor(Math.random() * workMessages.length)];

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`${job.emoji} Shift Complete!`)
    .setDescription(message)
    .addFields(
      { name: "Job", value: `${job.emoji} ${job.title}`, inline: true },
      { name: "Earned", value: `💰 **${formatNumber(earned)} gems**`, inline: true },
      { name: "Next Shift", value: `⏰ In 1 hour`, inline: true }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
