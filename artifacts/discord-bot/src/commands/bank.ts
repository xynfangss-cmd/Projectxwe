import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import {
  getOrCreateUser,
  getOrCreateBankAccount,
  updateBankAccount,
  updateUser,
  logTransaction,
} from "../utils/db.js";
import {
  BANK_INTEREST_RATE,
  BANK_MAX_BALANCE,
  formatNumber,
} from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("bank")
  .setDescription("Bank system — deposit, withdraw, check balance, or collect interest")
  .addSubcommand((sub) =>
    sub
      .setName("deposit")
      .setDescription("Deposit credits into the bank")
      .addStringOption((opt) =>
        opt.setName("amount").setDescription("Amount to deposit (or 'all')").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("withdraw")
      .setDescription("Withdraw credits from the bank")
      .addStringOption((opt) =>
        opt.setName("amount").setDescription("Amount to withdraw (or 'all')").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("balance").setDescription("View your bank balance and stats")
  )
  .addSubcommand((sub) =>
    sub.setName("interest").setDescription("Collect your 5% daily interest")
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const sub = interaction.options.getSubcommand();
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  const [user, bank] = await Promise.all([
    getOrCreateUser(userId, guildId, interaction.user.username),
    getOrCreateBankAccount(userId, guildId),
  ]);

  if (sub === "balance") {
    const lastInterest = bank.lastInterestAt ? bank.lastInterestAt.getTime() : 0;
    const interestReady = Date.now() - lastInterest >= 24 * 60 * 60 * 1000;
    const projectedInterest = Math.floor(bank.balance * BANK_INTEREST_RATE);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🏦 Bank Account")
      .addFields(
        { name: "Bank Balance", value: `💰 **${formatNumber(bank.balance)}** credits`, inline: true },
        { name: "Wallet", value: `👛 ${formatNumber(user.credits)} credits`, inline: true },
        { name: "Interest Rate", value: `📈 ${(BANK_INTEREST_RATE * 100).toFixed(0)}%/day`, inline: true },
        { name: "Total Deposited", value: `📥 ${formatNumber(bank.totalDeposited)}`, inline: true },
        { name: "Total Withdrawn", value: `📤 ${formatNumber(bank.totalWithdrawn)}`, inline: true },
        { name: "Interest Earned", value: `⭐ ${formatNumber(bank.totalInterestEarned)}`, inline: true },
        {
          name: "Daily Interest",
          value: interestReady
            ? `✅ Ready to collect! (+${formatNumber(projectedInterest)} credits)\nUse \`/bank interest\``
            : `⏳ Projected: +${formatNumber(projectedInterest)} credits`,
          inline: false,
        }
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  if (sub === "deposit") {
    const rawAmount = interaction.options.getString("amount", true);
    const amount = rawAmount.toLowerCase() === "all" ? user.credits : parseInt(rawAmount.replace(/,/g, ""));
    if (isNaN(amount) || amount <= 0) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Invalid Amount").setDescription("Please enter a valid amount or 'all'.").setTimestamp()] });
    }
    if (amount > user.credits) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Insufficient Funds").setDescription(`You only have **${formatNumber(user.credits)}** credits in your wallet.`).setTimestamp()] });
    }
    if (bank.balance + amount > BANK_MAX_BALANCE) {
      const canDeposit = BANK_MAX_BALANCE - bank.balance;
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Bank Full").setDescription(`You can only deposit **${formatNumber(canDeposit)}** more credits (max ${formatNumber(BANK_MAX_BALANCE)}).`).setTimestamp()] });
    }

    await Promise.all([
      updateUser(userId, guildId, { credits: user.credits - amount }),
      updateBankAccount(userId, guildId, {
        balance: bank.balance + amount,
        totalDeposited: bank.totalDeposited + amount,
      }),
      logTransaction(guildId, userId, amount, "credits", "deposit"),
    ]);

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("🏦 Deposit Successful")
      .addFields(
        { name: "Deposited", value: `💰 ${formatNumber(amount)} credits`, inline: true },
        { name: "Bank Balance", value: `🏦 ${formatNumber(bank.balance + amount)} credits`, inline: true },
        { name: "Wallet", value: `👛 ${formatNumber(user.credits - amount)} credits`, inline: true }
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  if (sub === "withdraw") {
    const rawAmount = interaction.options.getString("amount", true);
    const amount = rawAmount.toLowerCase() === "all" ? bank.balance : parseInt(rawAmount.replace(/,/g, ""));
    if (isNaN(amount) || amount <= 0) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Invalid Amount").setTimestamp()] });
    }
    if (amount > bank.balance) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Insufficient Bank Funds").setDescription(`You only have **${formatNumber(bank.balance)}** credits in the bank.`).setTimestamp()] });
    }

    await Promise.all([
      updateUser(userId, guildId, { credits: user.credits + amount }),
      updateBankAccount(userId, guildId, {
        balance: bank.balance - amount,
        totalWithdrawn: bank.totalWithdrawn + amount,
      }),
      logTransaction(guildId, userId, amount, "credits", "withdrawal"),
    ]);

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("🏦 Withdrawal Successful")
      .addFields(
        { name: "Withdrawn", value: `💰 ${formatNumber(amount)} credits`, inline: true },
        { name: "Bank Balance", value: `🏦 ${formatNumber(bank.balance - amount)} credits`, inline: true },
        { name: "Wallet", value: `👛 ${formatNumber(user.credits + amount)} credits`, inline: true }
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  if (sub === "interest") {
    const lastInterest = bank.lastInterestAt ? bank.lastInterestAt.getTime() : 0;
    const diff = Date.now() - lastInterest;
    const cooldown = 24 * 60 * 60 * 1000;

    if (diff < cooldown) {
      const remaining = cooldown - diff;
      const h = Math.floor(remaining / 3_600_000);
      const m = Math.floor((remaining % 3_600_000) / 60_000);
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("⏰ Interest Not Ready").setDescription(`Come back in **${h}h ${m}m** to collect your interest.`).setTimestamp()],
      });
    }

    if (bank.balance === 0) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ No Balance").setDescription("You have nothing in the bank to earn interest on!").setTimestamp()] });
    }

    const interest = Math.floor(bank.balance * BANK_INTEREST_RATE);
    await Promise.all([
      updateBankAccount(userId, guildId, {
        balance: bank.balance + interest,
        totalInterestEarned: bank.totalInterestEarned + interest,
        lastInterestAt: new Date(),
      }),
      logTransaction(guildId, userId, interest, "credits", "interest"),
    ]);

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle("📈 Interest Collected!")
      .addFields(
        { name: "Interest Earned", value: `🌟 **+${formatNumber(interest)} credits** (5%)`, inline: true },
        { name: "New Bank Balance", value: `🏦 ${formatNumber(bank.balance + interest)} credits`, inline: true }
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }
}
