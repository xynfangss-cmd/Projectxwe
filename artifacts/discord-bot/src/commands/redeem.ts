import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { redeemCode, getOrCreateUser, updateUser } from "../utils/db.js";
import { formatNumber } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("redeem")
  .setDescription("Redeem a gem code for rewards")
  .addStringOption((opt) =>
    opt.setName("code").setDescription("The code to redeem").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const raw     = interaction.options.getString("code", true);
  const code    = raw.toUpperCase().replace(/\s+/g, "-");
  const userId  = interaction.user.id;
  const guildId = interaction.guildId!;

  const result = await redeemCode(guildId, code, userId);

  if (result === "not_found") {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("❌ Invalid Code")
          .setDescription(`The code **${code}** doesn't exist or is no longer active.`)
          .setTimestamp(),
      ],
    });
    return;
  }

  if (result === "already_used") {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setTitle("⚠️ Already Redeemed")
          .setDescription(`You've already redeemed the code **${code}**.`)
          .setTimestamp(),
      ],
    });
    return;
  }

  if (result === "max_uses") {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("❌ Code Expired")
          .setDescription(`The code **${code}** has reached its maximum number of uses.`)
          .setTimestamp(),
      ],
    });
    return;
  }

  // result is the reward amount
  const reward  = result as number;
  const dbUser  = await getOrCreateUser(userId, guildId, interaction.user.username);
  await updateUser(userId, guildId, { credits: dbUser.credits + reward });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🎉 Code Redeemed!")
        .setDescription(`You redeemed **\`${code}\`** and received:`)
        .addFields(
          { name: "💎 Gems Received", value: `+${formatNumber(reward)}`, inline: true },
          { name: "💰 New Balance",   value: formatNumber(dbUser.credits + reward), inline: true },
        )
        .setFooter({ text: "Use /balance to check your wallet" })
        .setTimestamp(),
    ],
  });
}
