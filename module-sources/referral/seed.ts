import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * Who invited whom, in each of the three states the screen filters by.
 *
 * One referral per referred account is the schema's own rule, so this starts
 * from the accounts nobody has referred yet rather than walking the list and
 * colliding. A rerun therefore adds what it can and stops, instead of
 * reporting nothing done because the pairs it had in mind were taken.
 *
 * The operator's own account takes the first few. Their referral tab is a
 * link, four counters and a list of who used it, and with every referral hung
 * on a demo account all four counters read zero and the list was the empty
 * state - the one screen state nobody needs to look at.
 */

/** How many the operator invited. Enough to fill the counters and the list. */
const MINE = 3;

export const seed: ModuleSeed = {
    run: async (ctx) => {
        // Only the accounts this seed could pair up, so the read is bounded
        // by the demo roster rather than by how long the site has been running.
        const roster = ctx.users.map((user) => user.id);
        const referred = await ctx.prisma.referral.findMany({
            where: { referredId: { in: roster } },
            select: { referredId: true },
            take: roster.length,
        });
        const taken = new Set(referred.map((row) => row.referredId));

        const free = ctx.users.filter((user) => !taken.has(user.id) && user.id !== ctx.me.id);
        const inviters = ctx.users.slice(0, Math.max(1, Math.floor(ctx.users.length / 2)));
        const statuses = ["pending", "completed", "rewarded"];
        let made = 0;

        for (const [index, user] of free.entries()) {
            // Nobody invites themselves.
            const referrer = index < MINE ? ctx.me : inviters[index % inviters.length];
            if (referrer.id === user.id) continue;
            const status = statuses[index % statuses.length];
            await ctx.create("referral", () => ctx.prisma.referral.create({
                data: {
                    referrerId: referrer.id,
                    referredId: user.id,
                    status,
                    rewardAmount: status === "pending" ? 0 : ctx.pick([5, 10, 25]),
                    createdAt: ctx.daysAgo(150),
                },
            }));
            made += 1;
        }
        ctx.log(`${made} referrals`);
    },
};
