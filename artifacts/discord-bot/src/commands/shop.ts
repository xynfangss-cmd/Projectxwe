import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import {
  getOrCreateUser,
  updateUser,
  getShopItems,
  createShopItem,
  logTransaction,
} from "../utils/db.js";
import { db } from "@workspace/db";
import { discordShopItems } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { formatNumber } from "../utils/constants.js";

export const data = new SlashCommandBuilder()
  .setName("shop")
  .setDescription("Server shop — browse and buy items")
  .setDefaultMemberPermissions(null)
  .addSubcommand((sub) => sub.setName("view").setDescription("Browse the shop"))
  .addSubcommand((sub) =>
    sub
      .setName("buy")
      .setDescription("Buy an item from the shop")
      .addIntegerOption((opt) => opt.setName("id").setDescription("Item ID").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Add an item to the shop (admin)")
      .addStringOption((opt) => opt.setName("name").setDescription("Item name").setRequired(true))
      .addIntegerOption((opt) => opt.setName("price").setDescription("Price in gems").setRequired(true).setMinValue(1))
      .addStringOption((opt) => opt.setName("description").setDescription("Item description").setRequired(false))
      .addRoleOption((opt) => opt.setName("role").setDescription("Role to grant on purchase").setRequired(false))
      .addStringOption((opt) => opt.setName("emoji").setDescription("Emoji for the item").setRequired(false))
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove an item from the shop (admin)")
      .addIntegerOption((opt) => opt.setName("id").setDescription("Item ID").setRequired(true))
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;

  if (sub === "view") {
    const items = await getShopItems(guildId);
    if (items.length === 0) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🛒 Shop").setDescription("No items in the shop yet. Admins can use `/shop add` to add items!").setTimestamp()],
      });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🛒 Server Shop")
      .setDescription(
        items.map((i) => `**#${i.id}** ${i.emoji} **${i.name}** — ${formatNumber(i.price)} ${i.currency}\n${i.description}`).join("\n\n")
      )
      .setFooter({ text: "Use /shop buy <id> to purchase" })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === "buy") {
    const id = interaction.options.getInteger("id", true);
    const items = await getShopItems(guildId);
    const item = items.find((i) => i.id === id);
    if (!item) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Item Not Found").setTimestamp()] });
      return;
    }

    // Check if admin-only item
    const member = interaction.member;
    if (item.name.startsWith("[Admin]") && member) {
      const perms = typeof member.permissions === "string" ? BigInt(member.permissions) : member.permissions;
      if (typeof perms === "bigint" && !(perms & PermissionFlagsBits.ManageGuild)) {
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Admin Only").setTimestamp()] });
        return;
      }
    }

    const user = await getOrCreateUser(interaction.user.id, guildId, interaction.user.username);

    if (user.credits < item.price) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ Not Enough Credits")
          .setDescription(`You need **${formatNumber(item.price)}** gems but have **${formatNumber(user.credits)}**.`).setTimestamp()],
      });
      return;
    }

    await updateUser(interaction.user.id, guildId, { credits: user.credits - item.price });
    await db.update(discordShopItems).set({ soldCount: item.soldCount + 1 }).where(eq(discordShopItems.id, id));
    await logTransaction(guildId, interaction.user.id, item.price, item.currency, "shop_purchase");

    if (item.roleId) {
      const guildMember = interaction.guild?.members.cache.get(interaction.user.id);
      await guildMember?.roles.add(item.roleId).catch(() => {});
    }

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`${item.emoji} Purchase Successful!`)
      .setDescription(`You bought **${item.name}**!`)
      .addFields(
        { name: "Cost", value: `💰 ${formatNumber(item.price)} gems`, inline: true },
        { name: "Balance", value: `💰 ${formatNumber(user.credits - item.price)} gems`, inline: true },
        item.roleId ? { name: "Role Granted", value: `<@&${item.roleId}>`, inline: true } : { name: "\u200b", value: "\u200b", inline: true }
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === "add") {
    const member = interaction.member;
    const perms = member ? (typeof member.permissions === "string" ? BigInt(member.permissions) : member.permissions) : 0n;
    if (typeof perms !== "bigint" || !(perms & PermissionFlagsBits.ManageGuild)) {
      await interaction.editReply({ content: "You need Manage Server permission to add shop items.", });
      return;
    }

    const name = interaction.options.getString("name", true);
    const price = interaction.options.getInteger("price", true);
    const description = interaction.options.getString("description") ?? "No description";
    const role = interaction.options.getRole("role");
    const emoji = interaction.options.getString("emoji") ?? "🎁";

    const item = await createShopItem({
      guildId,
      name,
      price,
      description,
      roleId: role?.id,
      emoji,
      currency: "gems",
    });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("✅ Item Added to Shop")
      .addFields(
        { name: "ID", value: `#${item.id}`, inline: true },
        { name: "Name", value: `${emoji} ${name}`, inline: true },
        { name: "Price", value: `${formatNumber(price)} gems`, inline: true }
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === "remove") {
    const member = interaction.member;
    const perms = member ? (typeof member.permissions === "string" ? BigInt(member.permissions) : member.permissions) : 0n;
    if (typeof perms !== "bigint" || !(perms & PermissionFlagsBits.ManageGuild)) {
      await interaction.editReply({ content: "You need Manage Server permission to remove shop items." });
      return;
    }
    const id = interaction.options.getInteger("id", true);
    await db.update(discordShopItems).set({ isActive: false }).where(eq(discordShopItems.id, id));
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ Item Removed").setTimestamp()] });
    return;
  }
}
