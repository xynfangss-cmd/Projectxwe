import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  GuildMember,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("giverole")
  .setDescription("Admin: Give a role to a member")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addRoleOption((opt) =>
    opt.setName("role").setDescription("The role to give").setRequired(true)
  )
  .addUserOption((opt) =>
    opt.setName("member").setDescription("The member to give the role to").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return;
  }

  const role       = interaction.options.getRole("role", true);
  const targetUser = interaction.options.getUser("member", true);
  const guild      = interaction.guild!;

  let member: GuildMember;
  try {
    member = await guild.members.fetch(targetUser.id);
  } catch {
    await interaction.editReply({ content: `❌ Could not find that member in the server.` });
    return;
  }

  if (member.roles.cache.has(role.id)) {
    await interaction.editReply({ content: `⚠️ <@${targetUser.id}> already has <@&${role.id}>.` });
    return;
  }

  try {
    await member.roles.add(role.id, `Assigned by ${interaction.user.username}`);
  } catch {
    await interaction.editReply({
      content: `❌ Failed to assign the role — make sure my role is above <@&${role.id}> in the role list.`,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor((role as any).color || 0x5865f2)
    .setTitle("🎖️ Role Assigned")
    .setDescription(`<@${targetUser.id}> has been given <@&${role.id}>.`)
    .setThumbnail(member.displayAvatarURL())
    .addFields(
      { name: "Member", value: `<@${targetUser.id}>`, inline: true },
      { name: "Role",   value: `<@&${role.id}>`,       inline: true },
    )
    .setFooter({ text: `Assigned by ${interaction.user.username}` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
