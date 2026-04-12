# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains a Discord economy/XP bot (the main product) plus a shared API server scaffold.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Discord**: discord.js v14

## Discord Bot (`artifacts/discord-bot`)

A feature-rich Discord XP, economy, and community bot — a massive upgrade over the original GitHub project.

### Commands (16 total)
- `/rank [user]` — Rank card with XP, credits, level, progress bars, leaderboard position
- `/ranks` — View all 7 rank tiers
- `/leaderboard [type]` — Top 10 by credits or XP
- `/balance [user]` — Wallet + bank balance summary
- `/daily` — Daily credits (streak bonuses up to +500/day)
- `/weekly` — Weekly bonus (5K-10K credits + 250 XP)
- `/work` — 10 random jobs, 1h cooldown
- `/crime` — High-risk/high-reward crimes, 2h cooldown
- `/chest` — Mystery chest opener (750 XP cost, 7 reward tiers)
- `/bank deposit/withdraw/balance/interest` — 5% daily interest banking
- `/transfer` — Credit transfers between users
- `/gamble slots/coinflip/dice/blackjack` — Casino mini-games
- `/giveaway start/list/end/reroll` — Full giveaway management
- `/shop view/buy/add/remove` — Purchasable items with optional role rewards
- `/admin addcredits/removecredits/addxp/reset/setup/serverinfo` — Admin controls
- `/help` — Command reference

### Features
- 5-25 credits per message (1s cooldown), with rank-up notifications
- 7 rank tiers (Member → Copper → Gold → Emerald → Diamond → Ruby → Titanium)
- XP system: 100 XP per 10K credits earned; independent level system
- Daily streaks with escalating bonuses
- Bank with 5% daily interest, deposit/withdraw
- 4 gambling games (slots, coinflip, dice, blackjack)
- Giveaway system with entry costs, multi-winner, auto-end
- Shop system with role rewards
- Auto giveaway end checker (every 15 seconds)
- Per-guild configuration (multipliers, channels)

### Database Tables
- `discord_users` — User economy data
- `discord_bank_accounts` — Bank balances
- `discord_guild_settings` — Per-guild configuration
- `discord_chest_history` — Chest openings log
- `discord_giveaways` — Giveaway records
- `discord_shop_items` — Shop items
- `discord_transactions` — Transaction log
- `discord_role_rewards` — Role reward configuration

### Environment Variables Required
- `DISCORD_TOKEN` — Bot token (Replit Secret)
- `DISCORD_CLIENT_ID` — Application client ID (Replit Secret)
- `DATABASE_URL` — PostgreSQL connection string (auto-provisioned)
- `ADMIN_IDS` (optional) — Comma-separated Discord user IDs for admin bypass

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/discord-bot run start` — run Discord bot
- `pnpm --filter @workspace/discord-bot run deploy-commands` — re-deploy slash commands to Discord

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
