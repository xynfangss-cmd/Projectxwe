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
  .setDescription("Admin: Assign a role to a specific member or every member in the server")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addRoleOption((opt) =>
    opt
      .setName("role")
      .setDescription("The role to assign")
      .setRequired(true)
  )
  .addUserOption((opt) =>
    opt
      .setName("member")
      .setDescription("Target member — leave blank to assign to EVERYONE")
      .setRequired(false)
  );

// ── Helpers ────────────────────────────────────────────────────────────────
function progressBar(done: number, total: number, len = 14): string {
  const pct    = Math.min(done / total, 1);
  const filled = Math.round(pct * len);
  return "█".repeat(filled) + "░".repeat(len - filled);
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

// ── Command ────────────────────────────────────────────────────────────────
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return;
  }

  const role       = interaction.options.getRole("role", true);
  const targetUser = interaction.options.getUser("member", false);
  const guild      = interaction.guild!;
  const executor   = interaction.user;

  // Resolve role color — fall back to blurple if no color set
  const roleColor = (role as any).color || 0x5865f2;

  // ── SINGLE MEMBER ────────────────────────────────────────────────────────
  if (targetUser) {
    let member: GuildMember;
    try {
      member = await guild.members.fetch(targetUser.id);
    } catch {
      const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("❌ Member Not Found")
        .setDescription(`Could not find <@${targetUser.id}> in this server.`)
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (member.roles.cache.has(role.id)) {
      const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle("⚠️ Already Assigned")
        .setDescription(`<@${targetUser.id}> already has the <@&${role.id}> role.`)
        .setThumbnail(member.displayAvatarURL())
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    try {
      await member.roles.add(role.id, `Assigned by ${executor.username} via /giverole`);
    } catch {
      const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("❌ Permission Error")
        .setDescription(
          `Failed to assign <@&${role.id}>.\n\n` +
          `Make sure the bot's role is **above** <@&${role.id}> in Server Settings → Roles.`
        )
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(roleColor)
      .setTitle("🎖️ Role Assigned")
      .setDescription(`<@&${role.id}> has been successfully given to <@${targetUser.id}>.`)
      .setThumbnail(member.displayAvatarURL())
      .addFields(
        { name: "👤 Member",    value: `<@${targetUser.id}>`,  inline: true },
        { name: "🎭 Role",      value: `<@&${role.id}>`,        inline: true },
        { name: "👮 Assigned By", value: `<@${executor.id}>`,  inline: true },
      )
      .setFooter({ text: `GEM Bot  •  Role Management` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // ── BULK — ALL MEMBERS ───────────────────────────────────────────────────
  let allMembers;
  try {
    allMembers = await guild.members.fetch();
  } catch {
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("❌ Fetch Failed")
      .setDescription("Could not retrieve the member list. Check the bot's permissions.")
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const targets = allMembers.filter((m) => !m.user.bot && !m.roles.cache.has(role.id));
  const total   = targets.size;

  if (total === 0) {
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("✅ Already Up To Date")
      .setDescription(`Every member already has <@&${role.id}> — nothing to do!`)
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Show starting embed
  const startEmbed = new EmbedBuilder()
    .setColor(roleColor)
    .setTitle("⚙️ Assigning Role — In Progress")
    .setDescription(
      `Assigning <@&${role.id}> to **${total}** members…\n\n` +
      `\`${progressBar(0, total)}\` 0 / ${total}`
    )
    .addFields(
      { name: "🎭 Role",    value: `<@&${role.id}>`,   inline: true },
      { name: "👥 Targets", value: `${total} members`, inline: true },
    )
    .setFooter({ text: "This may take a moment for large servers…" })
    .setTimestamp();

  await interaction.editReply({ embeds: [startEmbed] });

  const startTime = Date.now();
  let success = 0;
  let failed  = 0;
  let i       = 0;

  for (const [, member] of targets) {
    try {
      await member.roles.add(role.id, `Bulk assign by ${executor.username} via /giverole`);
      success++;
    } catch {
      failed++;
    }
    i++;

    // Update progress every 10 members
    if (i % 10 === 0 || i === total) {
      const progressEmbed = new EmbedBuilder()
        .setColor(roleColor)
        .setTitle("⚙️ Assigning Role — In Progress")
        .setDescription(
          `Assigning <@&${role.id}> to **${total}** members…\n\n` +
          `\`${progressBar(i, total)}\` ${i} / ${total}`
        )
        .addFields(
          { name: "🎭 Role",    value: `<@&${role.id}>`,   inline: true },
          { name: "👥 Targets", value: `${total} members`, inline: true },
          { name: "✅ Done",    value: `${i} so far`,      inline: true },
        )
        .setFooter({ text: "This may take a moment for large servers…" })
        .setTimestamp();
      await interaction.editReply({ embeds: [progressEmbed] }).catch(() => {});
    }
  }

  const elapsed = Date.now() - startTime;

  // Final result embed
  const allOk   = failed === 0;
  const doneEmbed = new EmbedBuilder()
    .setColor(allOk ? roleColor : 0xfee75c)
    .setTitle(allOk ? "✅ Bulk Role Assignment Complete" : "⚠️ Bulk Assignment — Partial Success")
    .setDescription(
      allOk
        ? `<@&${role.id}> has been given to all **${success}** eligible members.`
        : `<@&${role.id}> was assigned to **${success}** members. **${failed}** failed (likely permission issues on specific members).`
    )
    .addFields(
      { name: "🎭 Role",       value: `<@&${role.id}>`,       inline: true },
      { name: "✅ Succeeded",  value: `${success} members`,   inline: true },
      { name: "❌ Failed",     value: `${failed} members`,    inline: true },
      { name: "⏱️ Duration",  value: duration(elapsed),       inline: true },
      { name: "👮 Run By",     value: `<@${executor.id}>`,    inline: true },
    )
    .setFooter({ text: "GEM Bot  •  Role Management" })
    .setTimestamp();

  await interaction.editReply({ embeds: [doneEmbed] });
}
