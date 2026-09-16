import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * The two pages nearly every community writes, so the page builder, the
 * footer's legal links and the /page/[slug] route have something behind them.
 */
const PAGES: [string, string, string][] = [
    ["Rules", "rules", `## The short version

Be decent to each other. No cheating, no advertising, no griefing.

## The long version

Cheating means any client that plays for you. Advertising means posting another server's address anywhere, including in a private message. Griefing means breaking or taking what someone else built.

Staff decisions can be appealed once, through a ticket.`],
    ["About us", "about", `This server has been running since 2019, on hardware we pay for out of what the store makes.

Everyone on the team plays here too. If something is broken, say so - it is the fastest way for it to get fixed.`],
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        for (const [index, [title, slug, content]] of PAGES.entries()) {
            const existing = await ctx.prisma.customPage.findUnique({ where: { slug } });
            if (existing) continue;
            await ctx.create("customPage", () => ctx.prisma.customPage.create({
                data: { title, slug, content, order: index, createdAt: ctx.daysAgo(300) },
            }));
        }
        ctx.log(`${PAGES.length} pages`);
    },
};
