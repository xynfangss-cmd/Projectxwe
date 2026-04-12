import { Client, EmbedBuilder, TextChannel } from "discord.js";
import { getActiveGiveaways, updateGiveaway } from "../utils/db.js";
import { pickWinners } from "../commands/giveaway.js";
import { formatNumber } from "../utils/constants.js";

export function startGiveawayManager(client: Client) {
  setInterval(async () => {
    const guilds = client.guilds.cache;
    for (const [guildId] of guilds) {
      try {
        const giveaways = await getActiveGiveaways(guildId);
        const now = Date.now();

        for (const giveaway of giveaways) {
          if (giveaway.endsAt.getTime() <= now) {
            const entrants = (giveaway.entrantsJson as string[]) ?? [];
            const winners = pickWinners(entrants, giveaway.winnerCount);

            await updateGiveaway(giveaway.id, {
              isActive: false,
              endedAt: new Date(),
              winnersJson: winners,
            });

            const channel = client.channels.cache.get(giveaway.channelId) as TextChannel | undefined;
            if (!channel) continue;

            const endEmbed = new EmbedBuilder()
              .setColor(winners.length > 0 ? 0xffd700 : 0x99aab5)
              .setTitle(`🎉 Giveaway Ended — ${giveaway.prize}`)
              .setDescription(
                winners.length > 0
                  ? `Winners: ${winners.map((w) => `<@${w}>`).join(", ")}\n\nCongratulations!`
                  : "No one entered this giveaway."
              )
              .addFields(
                { name: "Prize", value: giveaway.prize, inline: true },
                { name: "Total Entries", value: String(entrants.length), inline: true },
                { name: "Hosted by", value: `<@${giveaway.hostedBy}>`, inline: true }
              )
              .setTimestamp();

            if (giveaway.messageId) {
              await channel.messages.fetch(giveaway.messageId)
                .then((m) => m.edit({ embeds: [endEmbed], components: [] }))
                .catch(() => {});
            }

            if (winners.length > 0) {
              await channel.send({
                content: `Congratulations ${winners.map((w) => `<@${w}>`).join(", ")}! You won **${giveaway.prize}**! 🎉`,
              }).catch(() => {});
            }
          }
        }
      } catch {
        // silently continue
      }
    }
  }, 15_000);
}
