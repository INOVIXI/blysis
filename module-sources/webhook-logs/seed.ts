import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * A fortnight of deliveries, most of which arrived.
 *
 * This list was left unseeded on purpose until there was something writing
 * it: rows in a table nothing inserts into read as proof that deliveries are
 * being recorded, which was the opposite of true. Now that core announces
 * every webhook it sends, a history is an honest thing to show.
 *
 * The interesting rows are the failures, so there are three kinds: the
 * service refusing a message and saying which part it did not like, an
 * address that answered nothing at all, and a receiver that has simply gone.
 * A screen that only ever shows 204s teaches an operator nothing about what
 * this list is for.
 *
 * Addresses are origins, because that is what the log holds: a webhook URL is
 * the key to the channel behind it. See core's `webhook-log.ts`.
 */
const DELIVERIES: [string, string, number, string | null][] = [
    ["core.health", "https://discord.com", 204, null],
    ["discord.message", "https://discord.com", 204, null],
    ["discord.message", "https://discord.com", 400, '{"embeds":["0.description: Must be 4096 or fewer in length."]}'],
    ["core.health.test", "https://discord.com", 204, null],
    ["core.health", "https://ops.example.invalid", 0, "fetch failed"],
    ["discord.message", "https://discord.com", 429, '{"message":"You are being rate limited.","retry_after":2.5}'],
    ["core.health", "https://ops.example.invalid", 404, "Not Found"],
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        // Enough to page at twenty, and spread over the fortnight the cleanup
        // job keeps, so the list is not one timestamp repeated.
        const rounds = Math.max(4, ctx.scale * 2);
        let written = 0;
        for (let round = 0; round < rounds; round++) {
            for (const [event, url, status, response] of DELIVERIES) {
                await ctx.create("webhookLog", () => ctx.prisma.webhookLog.create({
                    data: { event, url, status, response, createdAt: ctx.daysAgo(14) },
                }));
                written += 1;
            }
        }
        ctx.log(`${written} webhook deliveries`);
    },
};
