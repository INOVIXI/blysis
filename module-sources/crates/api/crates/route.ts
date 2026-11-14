import { NextResponse } from "next/server";
import { prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { limitWindowStart, paymentFor, refusalFor, rewardChance, rewardHandsSomethingOver } from "../../lib/crates";

/**
 * The crates a visitor can see, what is in each and how likely it is.
 *
 * The odds are public on purpose and answered to everybody, signed in or not:
 * somebody about to pay for a crate has to be able to read what can come out
 * of it and how often before they pay. They are worked out here from the same
 * rewards the opening draws from, so the published figure and the draw cannot
 * disagree.
 *
 * A signed-in reader also gets what they hold and whether they may open each
 * one, so the page can draw an honest button.
 */

/** Names the reader, so no shared cache may hold a copy of it. */
const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET() {
    const session = await auth();
    const userId = session?.user?.id ?? null;
    const now = new Date();

    const [rows, user, rings] = await Promise.all([
        prisma.crateBox.findMany({
            where: { isActive: true },
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
            take: 50,
            select: {
                id: true,
                slug: true,
                name: true,
                description: true,
                image: true,
                cost: true,
                keyProductId: true,
                perPersonLimit: true,
                perPersonPeriod: true,
                roleIds: true,
                isActive: true,
                rewards: {
                    where: { isActive: true },
                    orderBy: { order: "asc" },
                    select: { id: true, name: true, kind: true, productId: true, value: true, weight: true, rarity: true },
                },
            },
        }),
        userId
            ? prisma.user.findUnique({ where: { id: userId }, select: { creditBalance: true, roleId: true } })
            : Promise.resolve(null),
        userId
            ? prisma.crateKey.findMany({ where: { userId }, select: { crateId: true, count: true }, take: 100 })
            : Promise.resolve([]),
    ]);
    const keysOf = new Map(rings.map((ring) => [ring.crateId, ring.count]));

    const crates = await Promise.all(rows.map(async (crate) => {
        const rewards = crate.rewards.filter((reward) => reward.weight > 0 && rewardHandsSomethingOver(reward));
        const windowStart = limitWindowStart(crate.perPersonPeriod, now);
        const opened = userId && crate.perPersonLimit > 0
            ? await prisma.crateOpening.count({
                where: { userId, crateId: crate.id, ...(windowStart ? { createdAt: { gte: windowStart } } : {}) },
            })
            : 0;
        const rules = {
            isActive: crate.isActive,
            cost: crate.cost,
            sellsKeys: Boolean(crate.keyProductId),
            perPersonLimit: crate.perPersonLimit,
            roleIds: crate.roleIds,
            hasRewards: rewards.length > 0,
        };
        const opener = {
            signedIn: Boolean(userId),
            roleId: user?.roleId ?? null,
            credits: Number(user?.creditBalance ?? 0),
            keys: keysOf.get(crate.id) ?? 0,
            openedInWindow: opened,
        };
        const pay = paymentFor(rules, opener, null);
        return {
            id: crate.id,
            slug: crate.slug,
            name: crate.name,
            description: crate.description,
            image: crate.image,
            cost: crate.cost,
            sellsKeys: rules.sellsKeys,
            perPersonLimit: crate.perPersonLimit,
            perPersonPeriod: crate.perPersonPeriod,
            restricted: crate.roleIds.length > 0,
            keys: opener.keys,
            openedInWindow: opened,
            canKey: refusalFor(rules, opener, "key") === null,
            canCredits: crate.cost > 0 && refusalFor(rules, opener, "credits") === null,
            refusal: refusalFor(rules, opener, pay),
            // The weight stays behind: the percentage is what a reader needs,
            // and it is the one figure the draw is held to.
            rewards: rewards.map((reward) => ({
                id: reward.id,
                name: reward.name,
                kind: reward.kind,
                value: reward.value,
                rarity: reward.rarity,
                chance: Math.round(rewardChance(rewards, reward) * 100) / 100,
            })),
        };
    }));

    return NextResponse.json({ crates, credits: Number(user?.creditBalance ?? 0) }, { headers: PRIVATE });
}
