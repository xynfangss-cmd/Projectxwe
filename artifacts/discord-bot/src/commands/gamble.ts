import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { getOrCreateUser, updateUser } from "../utils/db.js";
import {
  SLOT_SYMBOLS,
  SLOT_PAYOUTS,
  formatNumber,
  parseAmount,
} from "../utils/constants.js";

function spinSlots(): [string, string, string] {
  const weights = [20, 18, 16, 14, 10, 8, 4];
  function pick() {
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < SLOT_SYMBOLS.length; i++) {
      r -= weights[i];
      if (r <= 0) return SLOT_SYMBOLS[i];
    }
    return SLOT_SYMBOLS[0];
  }
  return [pick(), pick(), pick()];
}

function getSlotPayout(slots: [string, string, string]): { multiplier: number; label: string } {
  const key3 = slots.join("");
  if (SLOT_PAYOUTS[key3] != null) return { multiplier: SLOT_PAYOUTS[key3], label: "Jackpot!" };
  const key2 = slots[0] + slots[1];
  if (slots[0] === slots[1] && SLOT_PAYOUTS[key2] != null) return { multiplier: SLOT_PAYOUTS[key2], label: "Two in a row!" };
  return { multiplier: 0, label: "No match" };
}

export const data = new SlashCommandBuilder()
  .setName("gamble")
  .setDescription("Test your luck at the casino")
  .addSubcommand((sub) =>
    sub
      .setName("slots")
      .setDescription("Spin the slot machine")
      .addStringOption((opt) =>
        opt.setName("bet").setDescription("Amount to bet (e.g. 1k, 5m, 100)").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("coinflip")
      .setDescription("Flip a coin — heads or tails?")
      .addStringOption((opt) =>
        opt.setName("bet").setDescription("Amount to bet (e.g. 1k, 5m, 100)").setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName("choice").setDescription("Heads or tails?").setRequired(true)
          .addChoices({ name: "Heads", value: "heads" }, { name: "Tails", value: "tails" })
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("dice")
      .setDescription("Roll dice — pick a number 1-6")
      .addStringOption((opt) =>
        opt.setName("bet").setDescription("Amount to bet (e.g. 1k, 5m, 100)").setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt.setName("number").setDescription("Pick a number (1-6)").setRequired(true)
          .setMinValue(1).setMaxValue(6)
      )
  )
  ;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const sub    = interaction.options.getSubcommand();
  const betRaw = interaction.options.getString("bet", true);
  const bet    = parseAmount(betRaw);
  if (!bet || bet < 1) {
    await interaction.editReply({ content: "❌ Invalid bet. Use e.g. `100`, `1k`, `5m`." });
    return;
  }
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const user = await getOrCreateUser(userId, guildId, interaction.user.username);

  if (user.credits < bet) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Not Enough Gems")
        .setDescription(`You only have **${formatNumber(user.credits)}** gems.`).setTimestamp()],
    });
    return;
  }

  if (sub === "slots") {
    const slots = spinSlots();
    const { multiplier, label } = getSlotPayout(slots);
    const winnings = Math.floor(bet * multiplier);
    const net = winnings - bet;
    const newCredits = user.credits - bet + winnings;

    await updateUser(userId, guildId, { credits: newCredits });

    const slotDisplay = `| ${slots.join(" | ")} |`;
    const embed = new EmbedBuilder()
      .setColor(net >= 0 ? 0xffd700 : 0xed4245)
      .setTitle("🎰 Slot Machine")
      .setDescription(`\`${slotDisplay}\`\n\n**${label}**`)
      .addFields(
        { name: "Bet", value: `💰 ${formatNumber(bet)}`, inline: true },
        { name: net >= 0 ? "Won" : "Lost", value: `💰 ${formatNumber(Math.abs(net))}`, inline: true },
        { name: "Balance", value: `💰 ${formatNumber(newCredits)}`, inline: true }
      )
      .setTimestamp();

    if (multiplier >= 25) embed.setDescription(`\`${slotDisplay}\`\n\n🎉 **MEGA JACKPOT!!** 🎉`);
    await interaction.editReply({ embeds: [embed] });
  }

  if (sub === "coinflip") {
    const choice = interaction.options.getString("choice", true);
    const result = Math.random() < 0.5 ? "heads" : "tails";
    const won = choice === result;
    const net = won ? bet : -bet;
    const newCredits = user.credits + net;

    await updateUser(userId, guildId, { credits: newCredits });

    const coinEmoji = result === "heads" ? "🪙" : "🔵";
    const embed = new EmbedBuilder()
      .setColor(won ? 0x57f287 : 0xed4245)
      .setTitle(`${coinEmoji} Coin Flip — ${result.charAt(0).toUpperCase() + result.slice(1)}!`)
      .setDescription(won ? `You guessed **${choice}** and won!` : `You guessed **${choice}** but it was **${result}**.`)
      .addFields(
        { name: "Bet", value: `💰 ${formatNumber(bet)}`, inline: true },
        { name: won ? "Won" : "Lost", value: `💰 ${formatNumber(Math.abs(net))}`, inline: true },
        { name: "Balance", value: `💰 ${formatNumber(newCredits)}`, inline: true }
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  if (sub === "dice") {
    const pick = interaction.options.getInteger("number", true);
    const result = Math.floor(Math.random() * 6) + 1;
    const won = pick === result;
    const net = won ? bet * 5 : -bet;
    const newCredits = user.credits + net;

    await updateUser(userId, guildId, { credits: newCredits });

    const diceEmojis = ["", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];
    const embed = new EmbedBuilder()
      .setColor(won ? 0x57f287 : 0xed4245)
      .setTitle(`🎲 Dice Roll — ${diceEmojis[result]}`)
      .setDescription(won ? `You picked **${pick}** and it landed on **${result}**! 5x payout!` : `You picked **${pick}** but it landed on **${result}**.`)
      .addFields(
        { name: "Bet", value: `💰 ${formatNumber(bet)}`, inline: true },
        { name: won ? "Won" : "Lost", value: `💰 ${formatNumber(Math.abs(net))}`, inline: true },
        { name: "Balance", value: `💰 ${formatNumber(newCredits)}`, inline: true }
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

}
