import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  OverwriteType,
  TextChannel,
  Role,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("setupverify")
  .setDescription("Set up the verification system — creates Unverified/Verified roles and #verify channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild!;
  const steps: string[] = [];

  // ── 1. Create or find the "Unverified" role ───────────────────────────────
  let unverifiedRole: Role | null = guild.roles.cache.find(
    (r) => r.name.toLowerCase() === "unverified"
  ) ?? null;

  if (!unverifiedRole) {
    unverifiedRole = await guild.roles.create({
      name: "Unverified",
      color: 0x808080,
      permissions: [],
      reason: "GEM Bot verification setup",
    });
    steps.push("✅ Created **Unverified** role");
  } else {
    steps.push("✅ Found existing **Unverified** role");
  }

  // ── 2. Create or find the "Verified" role ─────────────────────────────────
  let verifiedRole: Role | null = guild.roles.cache.find(
    (r) => r.name.toLowerCase() === "verified"
  ) ?? null;

  if (!verifiedRole) {
    verifiedRole = await guild.roles.create({
      name: "Verified",
      color: 0x57f287,
      permissions: [],
      reason: "GEM Bot verification setup",
    });
    steps.push("✅ Created **Verified** role");
  } else {
    steps.push("✅ Found existing **Verified** role");
  }

  // ── 3. Set channel permissions — Verified can see all, Unverified cannot ──
  let lockedCount = 0;
  for (const [, channel] of guild.channels.cache) {
    if (
      channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildVoice &&
      channel.type !== ChannelType.GuildAnnouncement
    ) continue;
    if ((channel as TextChannel).name === "verify") continue;

    try {
      // Allow Verified to see the channel
      await channel.permissionOverwrites.edit(verifiedRole, {
        ViewChannel: true,
      });
      // Block Unverified from seeing the channel
      await channel.permissionOverwrites.edit(unverifiedRole, {
        ViewChannel: false,
      });
      lockedCount++;
    } catch { /* skip channels the bot can't edit */ }
  }
  steps.push(`✅ Updated permissions on **${lockedCount}** channel(s)`);

  // ── 4. Create or find the #verify channel ────────────────────────────────
  let verifyChannel = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === "verify"
  ) as TextChannel | undefined;

  if (!verifyChannel) {
    verifyChannel = await guild.channels.create({
      name: "verify",
      type: ChannelType.GuildText,
      topic: "Click the button below to verify and gain access to the server.",
      permissionOverwrites: [
        // @everyone cannot see it
        { id: guild.roles.everyone, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
        // Unverified CAN see and read it (no sending)
        {
          id: unverifiedRole,
          type: OverwriteType.Role,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          deny: [PermissionFlagsBits.SendMessages],
        },
        // Verified cannot see #verify (they're done)
        {
          id: verifiedRole,
          type: OverwriteType.Role,
          deny: [PermissionFlagsBits.ViewChannel],
        },
      ],
      reason: "GEM Bot verification channel",
    });
    steps.push("✅ Created **#verify** channel");
  } else {
    await verifyChannel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
    await verifyChannel.permissionOverwrites.edit(unverifiedRole, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: false,
    });
    await verifyChannel.permissionOverwrites.edit(verifiedRole, { ViewChannel: false });
    steps.push("✅ Updated **#verify** channel permissions");
  }

  // ── 5. Post the verification embed ────────────────────────────────────────
  const verifyEmbed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("✅ Welcome — Please Verify")
    .setDescription(
      [
        "Welcome to the server! 👋",
        "",
        "To gain access to all channels, click the **Verify** button below.",
        "",
        "**What happens when you verify:**",
        "• You'll instantly gain access to the entire server",
        "• Both you and the person who invited you receive **100,000,000 gems** 💎",
        "• You can start earning gems by chatting!",
      ].join("\n")
    )
    .setFooter({ text: "You must verify to access the server" })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_member")
      .setLabel("Verify")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
  );

  await verifyChannel.send({ embeds: [verifyEmbed], components: [row] });
  steps.push("✅ Posted verification embed in #verify");

  await interaction.editReply({
    content: [
      "**Verification system is live!** 🎉",
      "",
      steps.join("\n"),
      "",
      `**Unverified role:** <@&${unverifiedRole.id}> — assigned on join, can only see #verify`,
      `**Verified role:** <@&${verifiedRole.id}> — granted on verify, can see all channels`,
      `**Verify channel:** <#${verifyChannel.id}>`,
      "",
      "New members will automatically receive **Unverified** when they join and unlock the server once they click Verify.",
    ].join("\n"),
  });
}
