import { applyFiltersAsync } from "@/core/sdk";
import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * Two wheels, because one wheel tests nothing about having several.
 *
 * A free daily one everybody can turn, and a weekly one that costs credits -
 * between them they cover every rule the page has to draw: a cooldown, a
 * price, a wheel you can turn and one you cannot yet.
 */
const WHEELS: {
    slug: string;
    name: string;
    description: string;
    cooldown: string;
    cost: number;
    prizes: [string, string, number, number, string][];
}[] = [
    {
        slug: "daily",
        name: "Daily wheel",
        description: "One free turn a day. Everything on it is small; that is the point.",
        cooldown: "daily",
        cost: 0,
        prizes: [
            ["50 credits", "credits", 50, 30, "#3b82f6"],
            ["100 credits", "credits", 100, 20, "#22c55e"],
            ["250 credits", "credits", 250, 10, "#f59e0b"],
            ["Common Key", "product", 1, 20, "#06b6d4"],
            ["Rare Key", "product", 1, 10, "#a855f7"],
            ["Nothing this time", "nothing", 0, 8, "#6b7280"],
            ["Legendary Key", "product", 1, 2, "#eab308"],
        ],
    },
    {
        slug: "big-one",
        name: "The big one",
        description: "Costs credits, turns once a week, and the prizes are worth the wait.",
        cooldown: "weekly",
        cost: 250,
        prizes: [
            ["1000 credits", "credits", 1000, 20, "#3b82f6"],
            ["2500 credits", "credits", 2500, 8, "#22c55e"],
            ["10 percent off", "coupon", 10, 25, "#f59e0b"],
            ["25 percent off", "coupon", 25, 12, "#ef4444"],
            ["VIP", "product", 1, 5, "#a855f7"],
            ["Nothing this time", "nothing", 0, 30, "#6b7280"],
        ],
    },
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        let prizes = 0;
        let spins = 0;

        /*
         * What a prize of kind `product` hands over.
         *
         * Asked for rather than looked up: this module has no business
         * reading another's table, and on an install with nothing that owns
         * things the answer is empty - so a prize that cannot be filled is
         * seeded as `nothing`, which is the honest kind, rather than as a
         * promise nobody keeps. That is exactly what the four `item` prizes
         * here used to be.
         *
         * Matched by name, because the demo names its prizes after the things
         * the shop sells.
         */
        const grantables = await applyFiltersAsync("grantable.options", [], {});
        const thingCalled = new Map(grantables.map((thing) => [thing.label.toLowerCase(), thing.id]));

        for (const [index, plan] of WHEELS.entries()) {
            const existing = await ctx.prisma.wheel.findUnique({ where: { slug: plan.slug }, select: { id: true } });
            const wheel = existing ?? await ctx.create("wheel", () => ctx.prisma.wheel.create({
                data: {
                    slug: plan.slug,
                    name: plan.name,
                    description: plan.description,
                    cooldown: plan.cooldown,
                    cost: plan.cost,
                    order: index,
                },
            }));

            const madePrizes: { id: string; name: string; value: number }[] = [];
            for (const [order, [name, type, value, probability, color]] of plan.prizes.entries()) {
                const already = await ctx.prisma.wheelPrize.findFirst({ where: { wheelId: wheel.id, name } });
                if (already) { madePrizes.push(already); continue; }
                const productId = type === "product" ? thingCalled.get(name.toLowerCase()) ?? null : null;
                madePrizes.push(await ctx.create("wheelPrize", () => ctx.prisma.wheelPrize.create({
                    data: {
                        wheelId: wheel.id,
                        name,
                        // Nothing owns a thing by that name here, so the prize
                        // says what it is rather than promising one.
                        type: type === "product" && !productId ? "nothing" : type,
                        productId,
                        value,
                        probability,
                        color,
                        order,
                    },
                })));
                prizes += 1;
            }

            // A history, so the page has something behind "you turned this
            // recently" and the admin screen is not looking at an empty table.
            for (const user of ctx.some(ctx.users, Math.ceil(ctx.users.length / 2))) {
                for (let i = 0; i < ctx.int(0, 4); i++) {
                    const prize = ctx.pick(madePrizes);
                    await ctx.create("wheelSpin", () => ctx.prisma.wheelSpin.create({
                        data: {
                            userId: user.id,
                            wheelId: wheel.id,
                            prizeId: prize.id,
                            prizeName: prize.name,
                            prizeValue: prize.value,
                            createdAt: ctx.daysAgo(60),
                        },
                    }));
                    spins += 1;
                }
            }
        }

        ctx.log(`${WHEELS.length} wheels, ${prizes} prizes, ${spins} turns`);
    },
};
