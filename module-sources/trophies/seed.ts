import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * Trophies, and a believable spread of who has earned them.
 *
 * The public page shows how many people hold each one, so awarding them
 * evenly would make every trophy look equally common. The easy ones go to
 * most accounts, the rare ones to two or three.
 */
const TROPHIES: [string, string, number, string, string][] = [
    ["First Post", "Wrote something on the forum.", 5, "MessageSquare", "#3b82f6"],
    ["Welcome", "Signed in for the first time.", 5, "Hand", "#22c55e"],
    ["Regular", "Signed in on thirty different days.", 25, "CalendarCheck", "#8b5cf6"],
    ["Supporter", "Bought something from the store.", 20, "ShoppingBag", "#f59e0b"],
    ["Patron", "Spent over a hundred.", 100, "Crown", "#eab308"],
    ["Voter", "Voted for the server ten times.", 15, "Vote", "#06b6d4"],
    ["Helper", "Answered ten support threads.", 50, "LifeBuoy", "#10b981"],
    ["Bug Hunter", "Reported something that turned out to be real.", 40, "Bug", "#ef4444"],
    ["Veteran", "Been here a year.", 75, "Medal", "#a855f7"],
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        const trophies: { id: string; points: number }[] = [];
        for (const [name, description, points, icon, color] of TROPHIES) {
            const existing = await ctx.prisma.trophy.findFirst({ where: { name } });
            if (existing) { trophies.push(existing); continue; }
            trophies.push(await ctx.create("trophy", () => ctx.prisma.trophy.create({
                data: { name, description, points, icon, color },
            })));
        }

        let awarded = 0;
        for (const trophy of trophies) {
            // Worth more, held by fewer: the points are the difficulty.
            const share = trophy.points >= 75 ? 0.1 : trophy.points >= 40 ? 0.25 : trophy.points >= 20 ? 0.5 : 0.85;
            // The operator's own trophy case is the first one they open, and
            // it was always the empty state. All but the rarest: a case with
            // every trophy in it shows nothing about what rare looks like,
            // and the count under each trophy is what the public page is for.
            const holders = [
                ...(trophy.points < 75 ? [ctx.me] : []),
                ...ctx.some(ctx.users, Math.ceil(ctx.users.length * share)),
            ];
            for (const user of holders) {
                const already = await ctx.prisma.userTrophy.findFirst({
                    where: { userId: user.id, trophyId: trophy.id },
                });
                if (already) continue;
                await ctx.create("userTrophy", () => ctx.prisma.userTrophy.create({
                    data: { userId: user.id, trophyId: trophy.id, awardedAt: ctx.daysAgo(200) },
                }));
                awarded += 1;
            }
        }
        ctx.log(`${trophies.length} trophies, ${awarded} awarded`);
    },
};
