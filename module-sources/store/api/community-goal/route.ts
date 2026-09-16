import { NextRequest, NextResponse } from "next/server";
import { hasPermission, log, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { communityGoalSchema } from "../../lib/validations";

/**
 * This answer is the same whoever asked, so a proxy in front of the site may
 * hold it briefly. `s-maxage` speaks to shared caches and not to browsers, so
 * no visitor's own cache is involved. Anything here that ever starts varying
 * by who is asking has to lose this.
 */
const SHARED_CACHE = { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" };

// GET /api/v1/community-goal - Public endpoint
export async function GET() {
    try {
        const settings = await prisma.setting.findMany({
            where: { key: { startsWith: "community_goal_" } },
        });

        const settingsMap: Record<string, unknown> = {};
        for (const s of settings) {
            settingsMap[s.key] = s.value;
        }

        const target = Number(settingsMap.community_goal_target) || 0;
        const title = (settingsMap.community_goal_title as string) || "Monthly Goal";
        const endDate = (settingsMap.community_goal_end_date as string) || null;

        if (target <= 0) {
            return NextResponse.json({ target: 0, current: 0, title, endDate: null }, { headers: SHARED_CACHE });
        }

        // Calculate current from completed orders this month (or since goal start)
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const result = await prisma.order.aggregate({
            _sum: { total: true },
            where: {
                status: "COMPLETED",
                createdAt: { gte: monthStart },
            },
        });

        const current = Number(result._sum.total) || 0;

        return NextResponse.json({ target, current, title, endDate }, { headers: SHARED_CACHE });
    } catch (error) {
        log.error("Community goal error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ target: 0, current: 0, title: "Monthly Goal", endDate: null }, { headers: SHARED_CACHE });
    }
}

// PATCH /api/v1/community-goal - Admin only
export async function PATCH(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await hasPermission(session.user.id, "store.manage");
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    const parsed = communityGoalSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const fields = parsed.data;

    const updates: { key: string; value: unknown }[] = [];
    if (fields.target !== undefined) updates.push({ key: "community_goal_target", value: fields.target });
    if (fields.title !== undefined) updates.push({ key: "community_goal_title", value: fields.title });
    if (fields.endDate !== undefined) updates.push({ key: "community_goal_end_date", value: fields.endDate });

    // One transaction: a goal with its new target written and its old title
    // still in place is a goal nobody set.
    await prisma.$transaction(
        updates.map(({ key, value }) => prisma.setting.upsert({
            where: { key },
            update: { value: value as string },
            create: { key, value: value as string, module: "store" },
        })),
    );

    return NextResponse.json({ message: "Goal updated" });
}
