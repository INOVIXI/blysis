import { NextRequest, NextResponse } from "next/server";
import { applyFiltersAsync, doActionAsync } from "@/core/sdk";
import { prisma, rateLimitForRoleAsync } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { randomInt } from "crypto";
import { drawReward, limitWindowStart, paymentFor, refusalFor, rewardHandsSomethingOver, type Refusal } from "../../lib/crates";
import { openSchema } from "../../lib/validations";

/**
 * Open a crate.
 *
 * `?crate=<slug>` names which one and `?pay=key|credits` how to pay; without
 * `pay` a key is spent when the member holds one, and credits otherwise.
 *
 * The draw happens here, on the server, with `crypto.randomInt`, and the page
 * only shows the answer. A draw decided in the browser is a draw anybody can
 * re-roll until they like it.
 */

/** Why an opening was abandoned inside the transaction. Thrown so the transaction rolls back. */
class OpeningRefused extends Error {
    readonly code: string;

    constructor(code: string) {
        super(code);
        this.code = code;
    }
}

const STATUS: Record<Refusal, number> = {
    crate_off: 400,
    no_rewards: 400,
    not_for_sale: 400,
    signed_out: 401,
    wrong_role: 403,
    limit_reached: 429,
    no_key: 409,
    not_enough_credits: 409,
};

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.user.id;

    const allowed = await rateLimitForRoleAsync(
        `crate-open:${userId}`,
        { maxRequests: 30, windowMs: 3_600_000 },
        session.user.role,
    );
    if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const params = new URL(request.url).searchParams;
    const asked = openSchema.safeParse({ pay: params.get("pay") ?? undefined });
    if (!asked.success) return NextResponse.json({ error: asked.error.issues[0].message }, { status: 400 });

    const crate = await prisma.crateBox.findUnique({
        where: { slug: params.get("crate") ?? "" },
        select: {
            id: true,
            name: true,
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
    });
    if (!crate) return NextResponse.json({ error: "No crate here", code: "crate_missing" }, { status: 404 });

    // What can come out is what the odds were published for: a weighted
    // reward that hands something over. A product reward nobody pointed at a
    // product is left out of both, rather than drawn and given as nothing.
    const rewards = crate.rewards.filter((reward) => reward.weight > 0 && rewardHandsSomethingOver(reward));
    const now = new Date();
    const windowStart = limitWindowStart(crate.perPersonPeriod, now);

    const [user, ring, opened] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { creditBalance: true, roleId: true } }),
        prisma.crateKey.findUnique({ where: { userId_crateId: { userId, crateId: crate.id } }, select: { count: true } }),
        crate.perPersonLimit > 0
            ? prisma.crateOpening.count({
                where: { userId, crateId: crate.id, ...(windowStart ? { createdAt: { gte: windowStart } } : {}) },
            })
            : Promise.resolve(0),
    ]);

    const rules = {
        isActive: crate.isActive,
        cost: crate.cost,
        sellsKeys: Boolean(crate.keyProductId),
        perPersonLimit: crate.perPersonLimit,
        roleIds: crate.roleIds,
        hasRewards: rewards.length > 0,
    };
    const opener = {
        signedIn: true,
        roleId: user?.roleId ?? null,
        credits: Number(user?.creditBalance ?? 0),
        keys: ring?.count ?? 0,
        openedInWindow: opened,
    };
    const pay = paymentFor(rules, opener, asked.data.pay ?? null);
    const refusal = refusalFor(rules, opener, pay);
    if (refusal || !pay) {
        const code = refusal ?? "not_for_sale";
        return NextResponse.json({ error: code, code: `crate_${code}` }, { status: STATUS[code] });
    }

    const reward = drawReward(rewards, (max) => randomInt(0, max))!;

    // One opening is one event, so it is one transaction: the payment, the
    // row and the reward commit together or not at all. A refusal is thrown
    // rather than returned, because returning from the callback commits what
    // was already written - a key spent on a reward that was never given.
    //
    // The snapshot above is a snapshot: twenty requests sent together all read
    // "under the limit, holding one key". The lock on this member and this
    // crate makes the second wait for the first, and the limit is counted
    // again under it. The key is taken with a conditional decrement and the
    // credits by the wallet, which refuses what the balance cannot cover, so
    // neither can be spent twice either.
    let openingId: string;
    try {
        openingId = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crate-open:${userId}:${crate.id}`}))`;

            if (crate.perPersonLimit > 0) {
                const again = await tx.crateOpening.count({
                    where: { userId, crateId: crate.id, ...(windowStart ? { createdAt: { gte: windowStart } } : {}) },
                });
                if (again >= crate.perPersonLimit) throw new OpeningRefused("crate_limit_reached");
            }

            if (pay === "key") {
                const spent = await tx.crateKey.updateMany({
                    where: { userId, crateId: crate.id, count: { gte: 1 } },
                    data: { count: { decrement: 1 } },
                });
                if (spent.count === 0) throw new OpeningRefused("crate_no_key");
            } else {
                const paid = await applyFiltersAsync("credit.change", { applied: false }, {
                    tx,
                    userId,
                    amount: -crate.cost,
                    type: "crate_open",
                    description: `${crate.name}: opened (${crate.cost} credits)`,
                });
                if (!paid.applied) throw new OpeningRefused("crate_not_enough_credits");
            }

            const opening = await tx.crateOpening.create({
                data: {
                    crateId: crate.id,
                    crateName: crate.name,
                    userId,
                    rewardId: reward.id,
                    rewardName: reward.name,
                    rewardKind: reward.kind,
                    rewardValue: reward.value,
                    rarity: reward.rarity,
                    paidWith: pay,
                    cost: pay === "credits" ? crate.cost : 0,
                },
                select: { id: true },
            });

            if (reward.kind === "credits") {
                const credited = await applyFiltersAsync("credit.change", { applied: false }, {
                    tx,
                    userId,
                    amount: reward.value,
                    type: "crate_reward",
                    description: `${crate.name}: ${reward.name}`,
                });
                if (!credited.applied) throw new OpeningRefused("crate_reward_unavailable");
            } else if (reward.kind === "product" && reward.productId) {
                // The store owns what a product is and where it waits: the
                // chest, the same place a purchase waits to be claimed. A
                // product taken off the shelf since is refused, and the whole
                // opening goes with it - the fairest answer is that it did not
                // happen, not a row recording a reward nobody received.
                const handed = await applyFiltersAsync("product.grant", { granted: false }, {
                    tx,
                    userId,
                    productId: reward.productId,
                    quantity: Math.max(1, reward.value || 1),
                    reason: `${crate.name}: ${reward.name}`,
                });
                if (!handed.granted) throw new OpeningRefused("crate_reward_unavailable");
            }

            return opening.id;
        });
    } catch (error) {
        if (!(error instanceof OpeningRefused)) throw error;
        const status = error.code === "crate_limit_reached" ? 429 : 409;
        return NextResponse.json({ error: error.code, code: error.code }, { status });
    }

    await doActionAsync("crates.opened", {
        userId,
        crateId: crate.id,
        openingId,
        rewardId: reward.id,
        rewardName: reward.name,
        rewardKind: reward.kind,
        rewardValue: reward.value,
        paidWith: pay,
    });
    if (reward.kind !== "nothing") {
        await prisma.activityFeedItem.create({
            data: {
                type: "crates.opened",
                actorId: userId,
                title: `Got ${reward.name} from ${crate.name}`,
                icon: "Package",
                isPublic: true,
            },
        }).catch(() => {});
    }

    return NextResponse.json({
        opening: {
            id: openingId,
            paidWith: pay,
            reward: { id: reward.id, name: reward.name, kind: reward.kind, value: reward.value, rarity: reward.rarity },
        },
    });
}
