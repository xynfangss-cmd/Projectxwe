import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface BotStats {
  totalUsers: number;
  totalGuilds: number;
  activeGiveaways: number;
  botName: string;
  status: string;
}

interface LeaderboardEntry {
  userId: string;
  guildId: string;
  xp: number;
  level: number;
  coins: number;
  bank: number;
}

function useBotStats() {
  return useQuery<BotStats>({
    queryKey: ["bot-stats"],
    queryFn: () => fetch(`${BASE}/api/stats`).then((r) => r.json()),
    refetchInterval: 60_000,
  });
}

function useLeaderboard() {
  return useQuery<LeaderboardEntry[]>({
    queryKey: ["leaderboard"],
    queryFn: () => fetch(`${BASE}/api/leaderboard?limit=10`).then((r) => r.json()),
    refetchInterval: 120_000,
  });
}

const COMMANDS = [
  { name: "/rank", desc: "View your XP rank card", category: "XP" },
  { name: "/leaderboard", desc: "See the top users by XP", category: "XP" },
  { name: "/ranks", desc: "See all level-up role rewards", category: "XP" },
  { name: "/daily", desc: "Claim your daily coin reward", category: "Economy" },
  { name: "/weekly", desc: "Claim your weekly coin reward", category: "Economy" },
  { name: "/work", desc: "Work for coins (1h cooldown)", category: "Economy" },
  { name: "/crime", desc: "Attempt a risky crime for coins", category: "Economy" },
  { name: "/balance", desc: "Check your wallet & bank balance", category: "Economy" },
  { name: "/bank", desc: "Deposit or withdraw coins", category: "Economy" },
  { name: "/transfer", desc: "Send coins to another user", category: "Economy" },
  { name: "/gamble", desc: "Gamble your coins (slots/coinflip/dice)", category: "Economy" },
  { name: "/chest", desc: "Open a random loot chest", category: "Economy" },
  { name: "/shop", desc: "Browse & buy items from the shop", category: "Shop" },
  { name: "/giveaway", desc: "Start or manage giveaways", category: "Events" },
  { name: "/admin", desc: "Admin tools (set XP, coins, roles)", category: "Admin" },
  { name: "/help", desc: "View all commands and usage", category: "Info" },
];

const CATEGORY_COLORS: Record<string, string> = {
  XP: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  Economy: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  Shop: "bg-green-500/20 text-green-300 border-green-500/30",
  Events: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  Admin: "bg-red-500/20 text-red-300 border-red-500/30",
  Info: "bg-gray-500/20 text-gray-300 border-gray-500/30",
};

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5 flex items-center gap-4">
      <div className="text-3xl">{icon}</div>
      <div>
        <p className="text-sm text-gray-400">{label}</p>
        <p className="text-2xl font-bold text-white">{value.toLocaleString()}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useBotStats();
  const { data: leaderboard, isLoading: lbLoading } = useLeaderboard();

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      <header className="border-b border-white/10 bg-[#1a1d27]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl font-bold">
            💎
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">GEM Bot</h1>
            <p className="text-xs text-green-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400 inline-block animate-pulse" />
              Online
            </p>
          </div>
          <div className="ml-auto">
            <a
              href="https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=8"
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 transition-colors text-sm font-medium"
            >
              Add to Discord
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <section>
          <h2 className="text-lg font-semibold text-gray-300 mb-4">Live Stats</h2>
          {statsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-5 h-20 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Discord Servers" value={stats?.totalGuilds ?? 0} icon="🏠" />
              <StatCard label="Registered Users" value={stats?.totalUsers ?? 0} icon="👥" />
              <StatCard label="Active Giveaways" value={stats?.activeGiveaways ?? 0} icon="🎉" />
              <StatCard label="Total Commands" value={COMMANDS.length} icon="⚡" />
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section>
            <h2 className="text-lg font-semibold text-gray-300 mb-4">XP Leaderboard</h2>
            <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
              {lbLoading ? (
                <div className="p-6 space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-10 bg-white/5 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : !leaderboard || leaderboard.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <p className="text-4xl mb-2">📊</p>
                  <p>No users yet. Start chatting to earn XP!</p>
                </div>
              ) : (
                <ul>
                  {leaderboard.map((entry, i) => (
                    <li
                      key={`${entry.userId}-${entry.guildId}`}
                      className="flex items-center gap-4 px-5 py-3 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors"
                    >
                      <span
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                          i === 0
                            ? "bg-yellow-500 text-black"
                            : i === 1
                            ? "bg-gray-300 text-black"
                            : i === 2
                            ? "bg-amber-600 text-white"
                            : "bg-white/10 text-gray-400"
                        }`}
                      >
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white text-sm truncate">
                          {entry.userId}
                        </p>
                        <p className="text-xs text-gray-400">Level {entry.level}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-blue-400">{entry.xp.toLocaleString()} XP</p>
                        <p className="text-xs text-yellow-400">{(entry.coins + entry.bank).toLocaleString()} 💰</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-300 mb-4">Commands</h2>
            <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden max-h-[420px] overflow-y-auto">
              <ul>
                {COMMANDS.map((cmd) => (
                  <li
                    key={cmd.name}
                    className="flex items-center gap-3 px-5 py-3 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors"
                  >
                    <code className="text-indigo-300 text-sm font-mono whitespace-nowrap">
                      {cmd.name}
                    </code>
                    <p className="text-gray-400 text-sm flex-1 min-w-0 truncate">{cmd.desc}</p>
                    <span
                      className={`text-xs px-2 py-0.5 rounded border whitespace-nowrap ${CATEGORY_COLORS[cmd.category]}`}
                    >
                      {cmd.category}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        <section>
          <h2 className="text-lg font-semibold text-gray-300 mb-4">Features</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: "📊", title: "XP & Leveling", desc: "Earn XP by chatting. Level up and unlock role rewards automatically." },
              { icon: "💰", title: "Economy System", desc: "Full coin economy with daily rewards, work, crime, gambling, and a bank." },
              { icon: "🎁", title: "Chests & Loot", desc: "Open randomized loot chests to earn coins and bonus XP." },
              { icon: "🛒", title: "Item Shop", desc: "Buy and sell items. Admins can add custom items to the shop." },
              { icon: "🎉", title: "Giveaways", desc: "Run timed giveaways with automatic winner selection." },
              { icon: "🛡️", title: "Admin Tools", desc: "Set XP, coins, manage roles, and configure guild settings." },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-white/10 bg-white/5 p-5 hover:bg-white/10 transition-colors"
              >
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="font-semibold text-white mb-1">{f.title}</h3>
                <p className="text-sm text-gray-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-6 text-center text-gray-500 text-sm">
        GEM 💎 Bot · Built with discord.js v14 · Always online
      </footer>
    </div>
  );
}
