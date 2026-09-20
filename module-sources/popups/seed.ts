import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * Three popups, because the interesting ones are the two nobody sees.
 *
 * A popup has a window, and the two ends of that window are the whole of what
 * an operator gets wrong: one written for next week that went out today, one
 * that ended in March and is still on the screen. With a single row the panel
 * shows neither state, and the list cannot be told apart from the visitor's
 * answer - which is how it went unnoticed that the panel was reading the
 * visitor's answer.
 *
 * Only the first is live, so a seeded site pops one dialog and not three.
 */
const DAY = 24 * 60 * 60 * 1000;

export const seed: ModuleSeed = {
    run: async (ctx) => {
        const now = Date.now();
        const popups: {
            title: string;
            content: string;
            image: string | null;
            link: string | null;
            linkText: string | null;
            isActive: boolean;
            startsAt: Date | null;
            endsAt: Date | null;
        }[] = [
            {
                title: "Season 4 starts Friday",
                content: "The survival world resets at 18:00 UTC. Ranks and purchases carry over, builds do not.",
                image: "/demo/cover-event.svg",
                link: "/changelog",
                linkText: "Read what changed",
                isActive: true,
                startsAt: null,
                endsAt: new Date(now + 21 * DAY),
            },
            {
                title: "The winter sale opens on the 1st",
                content: "Written now, shown then. Nothing about this is on the site yet.",
                image: null,
                link: "/store",
                linkText: "Go to the store",
                isActive: true,
                startsAt: new Date(now + 7 * DAY),
                endsAt: new Date(now + 14 * DAY),
            },
            {
                title: "Voting closed",
                content: "The map vote finished. Thanks to everyone who turned up.",
                image: null,
                link: null,
                linkText: null,
                isActive: false,
                startsAt: ctx.daysAgo(60),
                endsAt: ctx.daysAgo(30),
            },
        ];

        for (const popup of popups) {
            const existing = await ctx.prisma.popup.findFirst({ where: { title: popup.title } });
            if (existing) continue;
            await ctx.create("popup", () => ctx.prisma.popup.create({ data: popup }));
        }
        ctx.log(`${popups.length} popups, one of them showing`);
    },
};
