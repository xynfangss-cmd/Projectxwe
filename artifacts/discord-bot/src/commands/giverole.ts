import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("giverole")
  .setDescription("Admin: Give a role to a specific member or every member in the server")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addRoleOption((opt) =>
    opt.setName("role").setDescription("The role to assign").setRequired(true)
  )
  .addUserOption((opt) =>
    opt.setName("member").setDescription("Specific member to give the role to (leave empty to give to ALL members)").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return;
  }

  const role        = interaction.options.getRole("role", true);
  const targetUser  = interaction.options.getUser("member", false);
  const guild       = interaction.guild!;

  // ── Single member ─────────────────────────────────────────────────────────
  if (targetUser) {
    let member;
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
      await member.roles.add(role.id, `Role granted by ${interaction.user.username}`);
    } catch {
      await interaction.editReply({ content: `❌ Failed to assign the role. Make sure my role is above <@&${role.id}> in the role list.` });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("✅ Role Assigned")
      .setDescription(`<@&${role.id}> has been given to <@${targetUser.id}>.`)
      .setFooter({ text: `Done by ${interaction.user.username}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── All members ───────────────────────────────────────────────────────────
  let members;
  try {
    members = await guild.members.fetch();
  } catch {
    await interaction.editReply({ content: "❌ Failed to fetch members. Check the bot's permissions." });
    return;
  }

  const targets = members.filter((m) => !m.user.bot && !m.roles.cache.has(role.id));

  if (targets.size === 0) {
    await interaction.editReply({ content: `✅ All members already have <@&${role.id}>.` });
    return;
  }

  await interaction.editReply({
    content: `⏳ Assigning <@&${role.id}> to **${targets.size}** members — this may take a moment…`,
  });

  let success = 0;
  let failed  = 0;

  for (const [, member] of targets) {
    try {
      await member.roles.add(role.id, `Bulk role grant by ${interaction.user.username}`);
      success++;
    } catch {
      failed++;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(failed === 0 ? 0x57f287 : 0xfee75c)
    .setTitle("✅ Bulk Role Assignment Complete")
    .addFields(
      { name: "Role",       value: `<@&${role.id}>`,    inline: true },
      { name: "✅ Success", value: `${success} members`, inline: true },
      { name: "❌ Failed",  value: `${failed} members`,  inline: true },
    )
    .setFooter({ text: `Run by ${interaction.user.username}` })
    .setTimestamp();

  await interaction.editReply({ content: "", embeds: [embed] });
}
