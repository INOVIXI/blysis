import { NextRequest, NextResponse } from "next/server";
import { hasPermission, pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

/** This answer depends on who asked, so nothing may keep a copy of it. */
const PRIVATE = { "Cache-Control": "private, no-store" };

/** 401 when nobody is signed in, 403 when they may not manage crates. */
async function refuse(): Promise<NextResponse | null> {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
    if (!(await hasPermission(session.user.id, "crates.manage"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE });
    }
    return null;
}

/**
 * Every opening, newest first, with who opened it: what an operator checks
 * when a member says a crate gave them nothing, and how they see the draw
 * coming out the way the published odds say it should.
 */
export async function GET(request: NextRequest) {
    const refused = await refuse();
    if (refused) return refused;

    const params = new URL(request.url).searchParams;
    const { page, limit, skip, take } = pageParams(params, { defaultLimit: 25, maxLimit: 100 });
    const crateId = params.get("crateId");
    // A member's name, a crate or a reward: the three things an operator
    // looking into "the crate gave me nothing" has to hand.
    const q = (params.get("q") ?? "").trim().slice(0, 100);
    const where = {
        ...(crateId ? { crateId } : {}),
        ...(q
            ? {
                OR: [
                    { crateName: { contains: q, mode: "insensitive" as const } },
                    { rewardName: { contains: q, mode: "insensitive" as const } },
                    { user: { username: { contains: q, mode: "insensitive" as const } } },
                ],
            }
            : {}),
    };
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
                user: { select: { id: true, username: true } },
            },
        }),
        prisma.crateOpening.count({ where }),
    ]);
    return NextResponse.json(
        { openings, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
        { headers: PRIVATE },
    );
}
