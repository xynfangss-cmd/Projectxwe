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
  .setDescription("Set up the verification system — creates the Unverified role and verify channel")
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

  // ── 2. Deny Unverified from viewing all existing text channels ────────────
  let lockedCount = 0;
  for (const [, channel] of guild.channels.cache) {
    if (
      channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildVoice &&
      channel.type !== ChannelType.GuildAnnouncement
    ) continue;
    if ((channel as TextChannel).name === "verify") continue;

    try {
      await channel.permissionOverwrites.edit(unverifiedRole, {
        ViewChannel: false,
      });
      lockedCount++;
    } catch { /* skip channels bot can't edit */ }
  }
  steps.push(`✅ Locked **${lockedCount}** channel(s) from Unverified`);

  // ── 3. Create or find the #verify channel ────────────────────────────────
  let verifyChannel = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === "verify"
  ) as TextChannel | undefined;

  if (!verifyChannel) {
    verifyChannel = await guild.channels.create({
      name: "verify",
      type: ChannelType.GuildText,
      topic: "Click the button below to verify and gain access to the server.",
      permissionOverwrites: [
        // Everyone can't see it by default
        { id: guild.roles.everyone, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
        // Unverified CAN see and read it (but not send messages except via bot)
        {
          id: unverifiedRole,
          type: OverwriteType.Role,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          deny: [PermissionFlagsBits.SendMessages],
        },
      ],
      reason: "GEM Bot verification channel",
    });
    steps.push("✅ Created **#verify** channel");
  } else {
    // Update its permissions
    await verifyChannel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
    await verifyChannel.permissionOverwrites.edit(unverifiedRole, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: false,
    });
    steps.push("✅ Updated **#verify** channel permissions");
  }

  // ── 4. Post the verification embed ────────────────────────────────────────
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
      `**Role to assign on join:** <@&${unverifiedRole.id}>`,
      `**Verify channel:** <#${verifyChannel.id}>`,
      "",
      "New members will automatically receive the **Unverified** role when they join and can only see **#verify** until they click the button.",
    ].join("\n"),
  });
}
