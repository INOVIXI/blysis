import { NextRequest, NextResponse } from "next/server";
import { prisma, translateContent } from "@/core/sdk/server";
import { TROPHY_TEXT } from "../../lib/validations";
import { auth } from "@/core/sdk/auth";

/**
 * GET /api/v1/me/trophies
 *
 * Returns the signed-in user's earned trophies plus the total count of
 * active trophies (so the profile card can show "X of Y earned"), each
 * trophy's name and description in `?locale=`.
 */
export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [earned, total] = await Promise.all([
        prisma.userTrophy.findMany({
            where: { userId: session.user.id },
            orderBy: { awardedAt: "desc" },
            include: {
                trophy: {
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        icon: true,
                        color: true,
                        points: true,
                    },
                },
            },
        }),
        prisma.trophy.count({ where: { isActive: true } }),
    ]);

    const locale = new URL(request.url).searchParams.get("locale") ?? "";
    const trophies = await translateContent(prisma, TROPHY_TEXT, earned.map((e) => e.trophy), ["name", "description"], locale);
    return NextResponse.json({
        earned: earned.map((e, i) => ({
            id: e.id,
            awardedAt: e.awardedAt.toISOString(),
            trophy: trophies[i],
        })),
        total,
    });
}
