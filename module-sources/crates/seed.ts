import { applyFiltersAsync } from "@/core/sdk";
import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * Two crates: one sold for credits with a daily limit, and one whose key the
 * shop sells, so the page has both ways of paying and a limit to show.
 *
 * Product rewards and keys are matched by name against what the shop offers
 * through `grantable.options`, and left out where nothing matches: a reward
 * that would hand over nothing is not seeded as a promise.
 */
const CRATES: {
    slug: string;
    name: string;
    description: string;
    cost: number;
    keyName: string | null;
    limit: number;
    rewards: [string, string, number, number, string][];
}[] = [
    {
        slug: "daily-crate",
        name: "Daily crate",
        description: "Credits in, something out. Three a day.",
        cost: 100,
        keyName: null,
        limit: 3,
        rewards: [
            ["50 credits", "credits", 50, 40, "common"],
            ["150 credits", "credits", 150, 25, "uncommon"],
            ["500 credits", "credits", 500, 8, "rare"],
            ["Common Key", "product", 1, 15, "uncommon"],
            ["Legendary Key", "product", 1, 2, "legendary"],
            ["Nothing this time", "nothing", 0, 10, "common"],
        ],
    },
    {
        slug: "legendary-crate",
        name: "Legendary crate",
        description: "Opened with a Legendary Key from the store.",
        cost: 0,
        keyName: "Legendary Key",
        limit: 0,
        rewards: [
            ["1000 credits", "credits", 1000, 50, "rare"],
            ["5000 credits", "credits", 5000, 10, "epic"],
            ["VIP", "product", 1, 5, "legendary"],
            ["Rare Key", "product", 1, 35, "rare"],
        ],
    },
];

export const seed: ModuleSeed = {
    run: async (ctx) => {
        const grantables = await applyFiltersAsync("grantable.options", [], {});
        const thingCalled = new Map(grantables.map((thing) => [thing.label.toLowerCase(), thing.id]));
        let rewards = 0;

        for (const [index, plan] of CRATES.entries()) {
            const existing = await ctx.prisma.crateBox.findUnique({ where: { slug: plan.slug }, select: { id: true } });
            const crate = existing ?? await ctx.create("crateBox", () => ctx.prisma.crateBox.create({
                data: {
                    slug: plan.slug,
                    name: plan.name,
                    description: plan.description,
                    cost: plan.cost,
                    keyProductId: plan.keyName ? thingCalled.get(plan.keyName.toLowerCase()) ?? null : null,
                    perPersonLimit: plan.limit,
                    perPersonPeriod: "day",
                    order: index,
                },
            }));

            for (const [order, [name, kind, value, weight, rarity]] of plan.rewards.entries()) {
                const productId = kind === "product" ? thingCalled.get(name.toLowerCase()) ?? null : null;
                if (kind === "product" && !productId) continue;
                const already = await ctx.prisma.crateReward.findFirst({ where: { crateId: crate.id, name }, select: { id: true } });
                if (already) continue;
                await ctx.create("crateReward", () => ctx.prisma.crateReward.create({
                    data: { crateId: crate.id, name, kind, productId, value, weight, rarity, order },
                }));
                rewards += 1;
            }
        }

        ctx.log(`${CRATES.length} crates, ${rewards} rewards`);
    },
};
