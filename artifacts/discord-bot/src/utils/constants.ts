export const RANKS = [
  { name: "Member",   emoji: "⚪", minCredits: 0,               color: 0x99aab5 },
  { name: "Copper",   emoji: "🟤", minCredits: 450_000_000,     color: 0xb87333 },
  { name: "Gold",     emoji: "🟡", minCredits: 1_250_000_000,   color: 0xffd700 },
  { name: "Emerald",  emoji: "🟢", minCredits: 4_250_000_000,   color: 0x50c878 },
  { name: "Diamond",  emoji: "🔵", minCredits: 8_500_000_000,   color: 0x00bfff },
  { name: "Ruby",     emoji: "🔴", minCredits: 16_500_000_000,  color: 0xe0115f },
  { name: "Titanium", emoji: "⚫", minCredits: 50_000_000_000,  color: 0x878787 },
] as const;

export const CREDITS_PER_MESSAGE_MIN = 5;
export const CREDITS_PER_MESSAGE_MAX = 25;
export const MESSAGE_COOLDOWN_MS = 1_000;
export const XP_PER_CREDITS = 100; // 100 XP per 10,000 gems earned
export const CREDITS_PER_XP_THRESHOLD = 10_000;
export const CHEST_COST_XP = 750;
export const BANK_INTEREST_RATE = 0.05;
export const BANK_MAX_BALANCE = 10_000_000;
export const DAILY_COOLDOWN_MS = 20 * 60 * 60 * 1000; // 20 hours
export const WEEKLY_COOLDOWN_MS = 6 * 24 * 60 * 60 * 1000; // 6 days
export const WORK_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
export const CRIME_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

export const CHEST_REWARDS = [
  { type: "Credit Boost",       weight: 30, minCredits: 1_000,   maxCredits: 5_000,   xp: 0,   emoji: "💰" },
  { type: "Credit Fortune",     weight: 25, minCredits: 5_000,   maxCredits: 15_000,  xp: 0,   emoji: "💵" },
  { type: "Credit Treasure",    weight: 20, minCredits: 15_000,  maxCredits: 30_000,  xp: 0,   emoji: "💎" },
  { type: "Credit Jackpot",     weight: 12, minCredits: 30_000,  maxCredits: 50_000,  xp: 0,   emoji: "🎰" },
  { type: "Credit Mega Jackpot",weight: 5,  minCredits: 50_000,  maxCredits: 100_000, xp: 0,   emoji: "🏆" },
  { type: "XP Boost",           weight: 5,  minCredits: 0,       maxCredits: 0,       xp: 200, emoji: "⭐" },
  { type: "XP Super Boost",     weight: 3,  minCredits: 0,       maxCredits: 0,       xp: 500, emoji: "🌟" },
] as const;

export const WORK_JOBS = [
  { title: "Programmer",    emoji: "💻", minPay: 800,  maxPay: 1_800  },
  { title: "Chef",          emoji: "👨‍🍳", minPay: 500,  maxPay: 1_200  },
  { title: "Doctor",        emoji: "🩺", minPay: 1_200, maxPay: 2_500 },
  { title: "Artist",        emoji: "🎨", minPay: 400,  maxPay: 1_000  },
  { title: "Engineer",      emoji: "⚙️", minPay: 900,  maxPay: 2_000  },
  { title: "Driver",        emoji: "🚗", minPay: 300,  maxPay: 800    },
  { title: "Teacher",       emoji: "📚", minPay: 600,  maxPay: 1_300  },
  { title: "Miner",         emoji: "⛏️", minPay: 700,  maxPay: 1_500  },
  { title: "Fisherman",     emoji: "🎣", minPay: 350,  maxPay: 900    },
  { title: "Astronaut",     emoji: "🚀", minPay: 2_000, maxPay: 5_000 },
] as const;

export const CRIME_OUTCOMES = [
  { type: "success", weight: 45, minGain: 1_000,  maxGain: 8_000,  fineRate: 0    },
  { type: "caught",  weight: 35, minGain: 0,       maxGain: 0,      fineRate: 0.15 },
  { type: "bigtime", weight: 15, minGain: 5_000,  maxGain: 20_000, fineRate: 0    },
  { type: "jackpot", weight: 5,  minGain: 20_000, maxGain: 50_000, fineRate: 0    },
] as const;

export const SLOT_SYMBOLS = ["🍒", "🍋", "🍊", "🍇", "💎", "⭐", "7️⃣"] as const;
export const SLOT_PAYOUTS: Record<string, number> = {
  "🍒🍒🍒": 3,
  "🍋🍋🍋": 4,
  "🍊🍊🍊": 5,
  "🍇🍇🍇": 8,
  "💎💎💎": 15,
  "⭐⭐⭐": 25,
  "7️⃣7️⃣7️⃣": 50,
  "🍒🍒":   1.5,
  "🍋🍋":   1.5,
};

export const LEVEL_XP_BASE = 100;
export const LEVEL_XP_MULTIPLIER = 1.5;

export function xpForLevel(level: number): number {
  return Math.floor(LEVEL_XP_BASE * Math.pow(level, LEVEL_XP_MULTIPLIER));
}

export function getRankForCredits(totalCredits: number) {
  const sorted = [...RANKS].reverse();
  return sorted.find((r) => totalCredits >= r.minCredits) ?? RANKS[0];
}

export function progressBar(current: number, max: number, length = 12): string {
  const pct = Math.min(current / max, 1);
  const filled = Math.round(pct * length);
  const empty = length - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function weightedRandom<T extends { weight: number }>(items: readonly T[]): T {
  const total = items.reduce((acc, i) => acc + i.weight, 0);
  let rand = Math.random() * total;
  for (const item of items) {
    rand -= item.weight;
    if (rand <= 0) return item;
  }
  return items[items.length - 1];
}
