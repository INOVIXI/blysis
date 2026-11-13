import { NextRequest, NextResponse } from "next/server";
import { pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

/**
 * The crates this member opened and what came out of each, newest first.
 *
 * Read from the opening rows, which keep the reward's name and value as they
 * were, so a reward an operator renamed or removed since still reads as what
 * the member was given.
 */

const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });

    const { page, limit, skip, take } = pageParams(new URL(request.url).searchParams, { defaultLimit: 10, maxLimit: 50 });
    const where = { userId: session.user.id };
    const [openings, total] = await Promise.all([
        prisma.crateOpening.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take,
            select: {
                id: true,
                crateName: true,
                rewardName: true,
                rewardKind: true,
                rewardValue: true,
                rarity: true,
                paidWith: true,
                cost: true,
                createdAt: true,
            },
        }),
        prisma.crateOpening.count({ where }),
    ]);

    return NextResponse.json(
        { openings, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
        { headers: PRIVATE },
    );
}
