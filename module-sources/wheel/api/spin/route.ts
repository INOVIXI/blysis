import { NextRequest, NextResponse } from "next/server";
import { applyFiltersAsync } from "@/core/sdk";
import { prisma, rateLimitForRoleAsync } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { randomInt } from "crypto";
import { drawPrize, nextTurnAt, refusalFor } from "../../lib/wheels";

/**
 * Turn a wheel.
 *
 * The rules - is it on, may this person reach it, have they turned it
 * recently, can they pay for it - are `refusalFor`, the same function the page
 * asks before it draws the button. Two copies of that logic is how a disabled
 * button and a working endpoint end up in the same release.
 *
 * `?wheel=<slug>` names which one. Without it, the first wheel the site has,
 * which is what an install with one wheel means by "the wheel".
 */
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const allowed = await rateLimitForRoleAsync(
        `wheel-spin:${session.user.id}`,
        { maxRequests: 20, windowMs: 3_600_000 },
        session.user.role,
    );
    if (!allowed) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const slug = new URL(request.url).searchParams.get("wheel");
    const wheel = await prisma.wheel.findFirst({
        where: slug ? { slug } : {},
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        include: { prizes: { where: { isActive: true }, orderBy: { order: "asc" } } },
    });
    if (!wheel) {
        return NextResponse.json({ error: "No wheel here", code: "wheel_missing" }, { status: 404 });
    }

    const [user, lastSpin] = await Promise.all([
        prisma.user.findUnique({
            where: { id: session.user.id },
            select: { creditBalance: true, roleId: true },
        }),
        prisma.wheelSpin.findFirst({
            where: { userId: session.user.id, wheelId: wheel.id },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
        }),
    ]);

    const rules = {
        cooldown: wheel.cooldown,
        cooldownHours: wheel.cooldownHours,
        cost: wheel.cost,
        roleIds: wheel.roleIds,
        isActive: wheel.isActive,
        hasPrizes: wheel.prizes.length > 0,
    };
    const refusal = refusalFor(rules, {
        signedIn: true,
        roleId: user?.roleId ?? null,
        credits: Number(user?.creditBalance ?? 0),
        lastTurn: lastSpin?.createdAt ?? null,
    });
    if (refusal) {
        // Each refusal is its own answer so the page can say which one it was
        // rather than "no": a wheel you may not reach, one you have to wait
        // for and one you cannot afford are three different things to a reader.
        // A wheel with nothing on it is not a rate limit and not a
        // permission: it is a wheel an operator has not finished setting up.
        const status = refusal === "wrong_role" ? 403 : refusal === "no_prizes" ? 400 : 429;
        return NextResponse.json(
            {
                error: refusal,
                code: `wheel_${refusal}`,
                cost: wheel.cost,
                nextTurnAt: nextTurnAt(rules, lastSpin?.createdAt ?? null),
            },
            { status },
        );
    }

    // Zero is a probability the screen accepts and the column stores, which is
    // how an operator switches one prize off. Do it to all of them and there
    // is nothing to draw from - said differently from a wheel with no prizes
    // at all (which `refusalFor` refused above) so an operator can tell the
    // two apart.
    const selectedPrize = drawPrize(wheel.prizes, (max) => randomInt(0, max));
    if (!selectedPrize) {
        return NextResponse.json(
            { error: "Every prize has odds of zero, so there is nothing to draw.", code: "wheel_no_odds" },
            { status: 400 },
        );
    }

    // A one-time coupon, minted here rather than inside the transaction so the
    // winner can be told the code even though the row is written below. The
    // suffix is random because two spins in the same millisecond used to
    // produce the same code, and `code` is unique: the second winner got a
    // 500 instead of a prize.
    const wonCoupon = selectedPrize.type === "coupon" && selectedPrize.value > 0;
    const couponCode = wonCoupon
        ? `WHEEL-${Date.now().toString(36).toUpperCase()}-${randomInt(0, 1679616).toString(36).toUpperCase().padStart(4, "0")}`
        : null;

    // One turn is one event, so it is one transaction.
    //
    // Every step of it used to be its own call. A paid turn decremented the
    // balance and then wrote the ledger row separately, so a failure in
    // between took a person's credits and left nothing saying where they went;
    // a credits prize did the same in the other direction, and a turn could be
    // paid for without being recorded at all. Either half failing now undoes
    // the other.
    const spun = await prisma.$transaction(async (tx) => {
        if (wheel.cost > 0) {
            // The balance read above is a snapshot: two turns submitted
            // together both saw enough credits, both turned, and the balance
            // went negative. The guard lives with the wallet now: the module
            // that owns it refuses a spend the balance cannot cover, on this
            // transaction, so a second request still finds nothing to take.
            const paid = await applyFiltersAsync("credit.change", { applied: false }, {
                tx,
                userId: session.user.id,
                amount: -wheel.cost,
                type: "wheel_spin",
                description: `${wheel.name}: paid turn (${wheel.cost} credits)`,
            });
            if (!paid.applied) return "wheel_not_enough_credits";
        }

        await tx.wheelSpin.create({
            data: {
                userId: session.user.id,
                wheelId: wheel.id,
                prizeId: selectedPrize.id,
                prizeName: selectedPrize.name,
                prizeValue: selectedPrize.value,
            },
        });

        if (selectedPrize.type === "credits" && selectedPrize.value > 0) {
            await applyFiltersAsync("credit.change", { applied: false }, {
                tx,
                userId: session.user.id,
                amount: selectedPrize.value,
                type: "wheel_prize",
                description: `${wheel.name}: ${selectedPrize.name}`,
            });
        } else if (couponCode) {
            // What a discount is belongs to the shop: this module knew its
            // table, its `FIXED` against `PERCENT` and its usage limit.
            await applyFiltersAsync("coupon.issue", { issued: false }, {
                tx,
                code: couponCode,
                description: `${wheel.name} prize: ${selectedPrize.name}`,
                amount: selectedPrize.value,
                usageLimit: 1,
            });
        } else if (selectedPrize.type === "product" && selectedPrize.productId) {
            // What a thing is belongs to whoever owns it. This module used to
            // know about credits and discounts and nothing else, so a prize of
            // any other kind was drawn, written down, announced in the public
            // feed and handed over as thin air.
            //
            // A refusal undoes the turn rather than recording a prize nobody
            // received: if the thing has since been taken down, the fairest
            // answer is that the turn did not happen.
            const handed = await applyFiltersAsync("product.grant", { granted: false }, {
                tx,
                userId: session.user.id,
                productId: selectedPrize.productId,
                quantity: Math.max(1, selectedPrize.value || 1),
                reason: `${wheel.name}: ${selectedPrize.name}`,
            });
            if (!handed.granted) return "wheel_prize_unavailable";
        }

        return null;
    });

    // Why the turn did not happen, or null because it did. It used to be a
    // boolean, and every falsehood was reported as an empty wallet - which
    // was true of the only case there was. A prize whose thing has since been
    // taken down is a different sentence and a different status.
    if (spun === "wheel_not_enough_credits") {
        return NextResponse.json(
            { error: "not_enough_credits", code: "wheel_not_enough_credits", cost: wheel.cost },
            { status: 429 },
        );
    }
    if (spun) {
        return NextResponse.json(
            { error: "That prize cannot be handed over right now", code: spun },
            { status: 409 },
        );
    }

    // Which slice to stop on, in the order the page drew them.
    const prizeIndex = wheel.prizes.findIndex((p) => p.id === selectedPrize.id);

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("wheel.spin.completed", {
        userId: session.user.id,
        wheelId: wheel.id,
        prizeId: selectedPrize.id,
        prizeName: selectedPrize.name,
        prizeType: selectedPrize.type,
        prizeValue: selectedPrize.value,
        paidSpin: wheel.cost > 0,
        spinCost: wheel.cost,
    });
    if (selectedPrize.value > 0) {
        await doActionAsync("wheel.prize.won", {
            userId: session.user.id,
            wheelId: wheel.id,
            prizeId: selectedPrize.id,
            prizeName: selectedPrize.name,
            prizeType: selectedPrize.type,
            prizeValue: selectedPrize.value,
        });
        await prisma.activityFeedItem.create({
            data: {
                type: "wheel.prize.won",
                actorId: session.user.id,
                title: `Won ${selectedPrize.name} on the wheel`,
                icon: "Gift",
                isPublic: true,
            },
        }).catch(() => {});
    }

    return NextResponse.json({
        prize: {
            id: selectedPrize.id,
            name: selectedPrize.name,
            type: selectedPrize.type,
            value: selectedPrize.value,
            color: selectedPrize.color,
            index: prizeIndex,
            // Without this a coupon prize was uncollectable: the row was
            // written and the code existed only in the database.
            code: couponCode,
        },
        cost: wheel.cost,
        nextTurnAt: nextTurnAt(rules, new Date()),
    });
}
