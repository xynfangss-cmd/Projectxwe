import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("giverole")
  .setDescription("Admin: Give a role to every member in the server")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addRoleOption((opt) =>
    opt.setName("role").setDescription("The role to assign to all members").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return;
  }

  const role   = interaction.options.getRole("role", true);
  const guild  = interaction.guild!;

  // Fetch all members
  let members;
  try {
    members = await guild.members.fetch();
  } catch {
    await interaction.editReply({ content: "❌ Failed to fetch members. Make sure the bot has the correct permissions." });
    return;
  }

  const targets = members.filter((m) => !m.user.bot && !m.roles.cache.has(role.id));

  if (targets.size === 0) {
    await interaction.editReply({ content: `✅ All members already have <@&${role.id}>.` });
    return;
  }

  await interaction.editReply({
    content: `⏳ Assigning <@&${role.id}> to **${targets.size}** members… this may take a moment.`,
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
    .setTitle("✅ Role Assignment Complete")
    .addFields(
      { name: "Role",        value: `<@&${role.id}>`,         inline: true },
      { name: "✅ Success",  value: `${success} members`,      inline: true },
      { name: "❌ Failed",   value: `${failed} members`,       inline: true },
    )
    .setFooter({ text: `Run by ${interaction.user.username}` })
    .setTimestamp();

  await interaction.editReply({ content: "", embeds: [embed] });
}
