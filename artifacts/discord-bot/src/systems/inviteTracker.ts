import { Client, Guild } from "discord.js";

// Cache of invite uses per guild: guildId → code → {uses, inviterId}
type InviteData = { uses: number; inviterId: string };
export const inviteCache = new Map<string, Map<string, InviteData>>();

// Pending invite rewards: newUserId → inviterId (cleared after verify)
export const pendingInviters = new Map<string, string>();

export async function cacheGuildInvites(guild: Guild): Promise<void> {
  try {
    const invites = await guild.invites.fetch();
    const cache = new Map<string, InviteData>();
    for (const [code, invite] of invites) {
      if (invite.inviter) {
        cache.set(code, { uses: invite.uses ?? 0, inviterId: invite.inviter.id });
      }
    }
    inviteCache.set(guild.id, cache);
  } catch {
    // Bot lacks Manage Guild permission to read invites — skip silently
  }
}

// Compare current invites to cache to find which invite was just used
export async function detectInviter(guild: Guild): Promise<string | null> {
  const cached = inviteCache.get(guild.id);
  if (!cached) return null;

  try {
    const current = await guild.invites.fetch();

    for (const [, inv] of current) {
      const prev = cached.get(inv.code);
      if (prev && inv.uses !== null && inv.uses > prev.uses && inv.inviter) {
        // Update cache for this invite
        cached.set(inv.code, { uses: inv.uses, inviterId: inv.inviter.id });
        return inv.inviter.id;
      }
    }

    // Re-sync cache in case no match was found
    for (const [, inv] of current) {
      if (inv.inviter) {
        cached.set(inv.code, { uses: inv.uses ?? 0, inviterId: inv.inviter.id });
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function startInviteTracker(client: Client): void {
  client.on("inviteCreate", (invite) => {
    if (!invite.guild || !invite.inviter) return;
    const cache = inviteCache.get(invite.guild.id) ?? new Map<string, InviteData>();
    cache.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter.id });
    inviteCache.set(invite.guild.id, cache);
  });

  client.on("inviteDelete", (invite) => {
    if (!invite.guild) return;
    inviteCache.get(invite.guild.id)?.delete(invite.code);
  });
}
