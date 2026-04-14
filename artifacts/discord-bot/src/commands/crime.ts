import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { getOrCreateUser, updateUser, addCredits } from "../utils/db.js";
import {
  CRIME_COOLDOWN_MS,
  CRIME_OUTCOMES,
  weightedRandom,
  formatNumber,
  formatTime,
} from "../utils/constants.js";

const CRIME_SCENARIOS = {
  success: [
    "You pickpocketed a wealthy merchant.",
    "You robbed a casino vault.",
    "You hacked into a corporation's servers.",
    "You pulled off a smooth con job.",
    "You stole from the rich (not giving to the poor).",
  ],
  caught: [
    "The police caught you red-handed!",
    "A witness called the cops on you.",
    "Your disguise fell off at the worst moment.",
    "You tripped the alarm.",
    "Your accomplice snitched on you.",
  ],
  bigtime: [
    "You orchestrated a bank heist!",
    "You pulled off a sophisticated fraud scheme.",
    "You intercepted a rare gem shipment.",
  ],
  jackpot: [
    "You stole from the government treasury!",
    "You found a hidden vault of forgotten riches.",
    "You pulled off the perfect crime of the century!",
  ],
};

export const data = new SlashCommandBuilder()
  .setName("crime")
  .setDescription("Attempt a crime for big rewards — but risk getting caught (2 hour cooldown)");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const user = await getOrCreateUser(userId, guildId, interaction.user.username);

  const now = Date.now();
  const lastCrime = user.lastCrimeAt ? user.lastCrimeAt.getTime() : 0;
  const diff = now - lastCrime;

  if (diff < CRIME_COOLDOWN_MS) {
    const remaining = CRIME_COOLDOWN_MS - diff;
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle("⏰ Laying Low")
      .setDescription(`You're still laying low after your last crime!\nWait **${formatTime(remaining)}** before trying again.`)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const outcome = weightedRandom(CRIME_OUTCOMES);
  const scenarios = CRIME_SCENARIOS[outcome.type as keyof typeof CRIME_SCENARIOS];
  const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];

  await updateUser(userId, guildId, { lastCrimeAt: new Date() });

  if (outcome.type === "caught") {
    const fine = Math.floor(user.credits * outcome.fineRate);
    const newCredits = Math.max(0, user.credits - fine);
    await updateUser(userId, guildId, { credits: newCredits });

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("🚔 Busted!")
      .setDescription(scenario)
      .addFields(
        { name: "Fine Paid", value: `💸 ${formatNumber(fine)} gems`, inline: true },
        { name: "New Balance", value: `💰 ${formatNumber(newCredits)} gems`, inline: true }
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const gain = Math.floor(Math.random() * (outcome.maxGain - outcome.minGain + 1)) + outcome.minGain;
  await addCredits(userId, guildId, gain);

  const colors: Record<string, number> = { success: 0x57f287, bigtime: 0xffd700, jackpot: 0xff6600 };
  const titles: Record<string, string> = {
    success: "🕵️ Crime Successful!",
    bigtime: "💰 Big Time Score!",
    jackpot: "🎰 JACKPOT HEIST!",
  };

  const embed = new EmbedBuilder()
    .setColor(colors[outcome.type] ?? 0x57f287)
    .setTitle(titles[outcome.type] ?? "Crime Successful!")
    .setDescription(scenario)
    .addFields(
      { name: "Stolen", value: `💰 **${formatNumber(gain)} gems**`, inline: true },
      { name: "New Balance", value: `💰 ${formatNumber(user.credits + gain)} gems`, inline: true }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
