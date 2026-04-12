import { Router } from "express";
import { db } from "@workspace/db";
import { discordUsers, discordGuildSettings, discordGiveaways } from "@workspace/db";
import { sql, desc } from "drizzle-orm";

const router = Router();

router.get("/stats", async (_req, res) => {
  try {
    const [userCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(discordUsers);

    const [guildCount] = await db
      .select({ count: sql<number>`count(distinct guild_id)::int` })
      .from(discordUsers);

    const [activeGiveaways] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(discordGiveaways)
      .where(sql`is_active = true`);

    res.json({
      totalUsers: userCount?.count ?? 0,
      totalGuilds: guildCount?.count ?? 0,
      activeGiveaways: activeGiveaways?.count ?? 0,
      botName: "GEM 💎",
      status: "online",
    });
  } catch {
    res.json({
      totalUsers: 0,
      totalGuilds: 0,
      activeGiveaways: 0,
      botName: "GEM 💎",
      status: "online",
    });
  }
});

router.get("/leaderboard", async (req, res) => {
  try {
    const guildId = req.query.guildId as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 10), 50);

    const query = db
      .select({
        userId: discordUsers.userId,
        guildId: discordUsers.guildId,
        xp: discordUsers.xp,
        level: discordUsers.level,
        coins: discordUsers.coins,
        bank: discordUsers.bank,
      })
      .from(discordUsers)
      .orderBy(desc(discordUsers.xp))
      .limit(limit);

    if (guildId) {
      const rows = await query.where(sql`guild_id = ${guildId}`);
      res.json(rows);
    } else {
      const rows = await query;
      res.json(rows);
    }
  } catch {
    res.json([]);
  }
});

export default router;
