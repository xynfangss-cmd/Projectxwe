import { db } from "@workspace/db";
import {
  discordUsers,
  discordBankAccounts,
  discordGuildSettings,
  discordChestHistory,
  discordGiveaways,
  discordShopItems,
  discordTransactions,
} from "@workspace/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getRankForCredits, xpForLevel } from "./constants.js";

export type DiscordUser = typeof discordUsers.$inferSelect;
export type GuildSettings = typeof discordGuildSettings.$inferSelect;
export type Giveaway = typeof discordGiveaways.$inferSelect;
export type ShopItem = typeof discordShopItems.$inferSelect;

export async function getOrCreateUser(userId: string, guildId: string, username?: string): Promise<DiscordUser> {
  const [existing] = await db
    .select()
    .from(discordUsers)
    .where(and(eq(discordUsers.userId, userId), eq(discordUsers.guildId, guildId)))
    .limit(1);

  if (existing) {
    if (username && existing.username !== username) {
      const [updated] = await db
        .update(discordUsers)
        .set({ username, updatedAt: new Date() })
        .where(and(eq(discordUsers.userId, userId), eq(discordUsers.guildId, guildId)))
        .returning();
      return updated;
    }
    return existing;
  }

  const [created] = await db
    .insert(discordUsers)
    .values({ userId, guildId, username: username ?? "" })
    .returning();
  return created;
}

export async function updateUser(userId: string, guildId: string, data: Partial<DiscordUser>) {
  const [updated] = await db
    .update(discordUsers)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(discordUsers.userId, userId), eq(discordUsers.guildId, guildId)))
    .returning();
  return updated;
}

export async function addCredits(userId: string, guildId: string, amount: number): Promise<DiscordUser> {
  const user = await getOrCreateUser(userId, guildId);
  const newCredits = user.credits + amount;
  const newTotalEarned = user.totalCreditsEarned + Math.max(0, amount);
  const newRank = getRankForCredits(newTotalEarned);

  // XP from gems
  const newXpFromCredits = Math.floor(newTotalEarned / 10_000) * 100;
  const currentXpFromCredits = Math.floor(user.totalCreditsEarned / 10_000) * 100;
  const xpGained = newXpFromCredits - currentXpFromCredits;
  const newXp = user.xp + xpGained;

  // Level up
  let newLevel = user.level;
  while (newXp >= xpForLevel(newLevel + 1)) {
    newLevel++;
  }

  return updateUser(userId, guildId, {
    credits: Math.max(0, newCredits),
    totalCreditsEarned: newTotalEarned,
    xp: newXp,
    level: newLevel,
    rank: newRank.name,
  });
}

export async function addXp(userId: string, guildId: string, xpAmount: number): Promise<DiscordUser> {
  const user = await getOrCreateUser(userId, guildId);
  const newXp = user.xp + xpAmount;
  let newLevel = user.level;
  while (newXp >= xpForLevel(newLevel + 1)) {
    newLevel++;
  }
  return updateUser(userId, guildId, { xp: newXp, level: newLevel });
}

export async function getLeaderboard(guildId: string, limit = 10) {
  return db
    .select()
    .from(discordUsers)
    .where(eq(discordUsers.guildId, guildId))
    .orderBy(desc(discordUsers.totalCreditsEarned))
    .limit(limit);
}

export async function getLeaderboardByXp(guildId: string, limit = 10) {
  return db
    .select()
    .from(discordUsers)
    .where(eq(discordUsers.guildId, guildId))
    .orderBy(desc(discordUsers.xp))
    .limit(limit);
}

export async function getUserRank(userId: string, guildId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(discordUsers)
    .where(
      and(
        eq(discordUsers.guildId, guildId),
        sql`total_credits_earned > (SELECT total_credits_earned FROM discord_users WHERE user_id = ${userId} AND guild_id = ${guildId})`
      )
    );
  return (result[0]?.count ?? 0) + 1;
}

export async function getOrCreateGuildSettings(guildId: string): Promise<GuildSettings> {
  const [existing] = await db
    .select()
    .from(discordGuildSettings)
    .where(eq(discordGuildSettings.guildId, guildId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(discordGuildSettings)
    .values({ guildId })
    .returning();
  return created;
}

export async function updateGuildSettings(guildId: string, data: Partial<GuildSettings>) {
  const [updated] = await db
    .update(discordGuildSettings)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(discordGuildSettings.guildId, guildId))
    .returning();
  return updated;
}

export async function getOrCreateBankAccount(userId: string, guildId: string) {
  const [existing] = await db
    .select()
    .from(discordBankAccounts)
    .where(and(eq(discordBankAccounts.userId, userId), eq(discordBankAccounts.guildId, guildId)))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(discordBankAccounts)
    .values({ userId, guildId })
    .returning();
  return created;
}

export async function updateBankAccount(userId: string, guildId: string, data: Partial<typeof discordBankAccounts.$inferSelect>) {
  const [updated] = await db
    .update(discordBankAccounts)
    .set(data)
    .where(and(eq(discordBankAccounts.userId, userId), eq(discordBankAccounts.guildId, guildId)))
    .returning();
  return updated;
}

export async function logChestReward(userId: string, guildId: string, rewardType: string, rewardAmount: number, costXp: number) {
  await db.insert(discordChestHistory).values({ userId, guildId, rewardType, rewardAmount, costXp });
}

export async function logTransaction(guildId: string, toUserId: string, amount: number, currency: string, type: string, fromUserId?: string, note?: string) {
  await db.insert(discordTransactions).values({ guildId, toUserId, fromUserId, amount, currency, type, note });
}

export async function createGiveaway(data: typeof discordGiveaways.$inferInsert) {
  const [created] = await db.insert(discordGiveaways).values(data).returning();
  return created;
}

export async function getActiveGiveaways(guildId: string) {
  return db
    .select()
    .from(discordGiveaways)
    .where(and(eq(discordGiveaways.guildId, guildId), eq(discordGiveaways.isActive, true)));
}

export async function getGiveaway(id: number) {
  const [giveaway] = await db
    .select()
    .from(discordGiveaways)
    .where(eq(discordGiveaways.id, id))
    .limit(1);
  return giveaway;
}

export async function updateGiveaway(id: number, data: Partial<typeof discordGiveaways.$inferSelect>) {
  const [updated] = await db
    .update(discordGiveaways)
    .set(data)
    .where(eq(discordGiveaways.id, id))
    .returning();
  return updated;
}

export async function getShopItems(guildId: string) {
  return db
    .select()
    .from(discordShopItems)
    .where(and(eq(discordShopItems.guildId, guildId), eq(discordShopItems.isActive, true)));
}

export async function createShopItem(data: typeof discordShopItems.$inferInsert) {
  const [created] = await db.insert(discordShopItems).values(data).returning();
  return created;
}
