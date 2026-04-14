import { ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";

// Users who are always treated as admins regardless of their Discord roles
export const SUPER_ADMINS = ["1475533428647792701"];

export function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (SUPER_ADMINS.includes(interaction.user.id)) return true;
  const member = interaction.member;
  if (!member) return false;
  if (typeof member.permissions === "string") return false;
  return member.permissions.has(PermissionFlagsBits.Administrator);
}
