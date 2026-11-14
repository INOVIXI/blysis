/**
 * GET /api/v1/ai-moderation/stats - the dashboard's panel: what the AI
 * reviewer did today, on the site's clock.
 *
 * Four counts, each a row that opens the log narrowed to it. A call that
 * failed is counted as an error, apart from the items the reviewer left
 * because it was not sure: the first wants the operator's attention, the
 * second is the reviewer working as meant.
 */
import { NextResponse } from "next/server";
import { instantToWallClock, wallClockToInstant } from "@/core/sdk";
import { hasPermission, prisma, siteTimeZone } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { MANAGE } from "../../lib/admin";

const ROWS = [
    { id: "approve", label: "Approved", where: { applied: "approve", verdict: { not: "error" } } },
    { id: "reject", label: "Rejected", where: { applied: "reject", verdict: { not: "error" } } },
    { id: "leave", label: "Left for a person", where: { applied: "leave", verdict: { not: "error" } } },
    { id: "error", label: "Could not decide", where: { verdict: "error" } },
] as const;

const BADGE_COLOR = { approve: "green", reject: "red", leave: "yellow", error: "gray" } as const;

export async function GET() {
    // The dashboard is the only caller and it is behind the panel; the
    // numbers are nobody else's business.
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, MANAGE))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const now = new Date();
    const zone = await siteTimeZone();
    const midnight = wallClockToInstant(`${instantToWallClock(now, zone).slice(0, 10)}T00:00`, zone) ?? now;

    const counts = await Promise.all(
        ROWS.map((row) => prisma.aiModerationReview.count({ where: { ...row.where, createdAt: { gte: midnight } } })),
    );

    return NextResponse.json({
        stats: {},
        sections: [{
            id: "ai-moderation-today",
            title: "AI moderation today",
            titleKey: "dashboard_aiModerationToday",
            viewAllHref: "/admin/ai-moderation",
            items: ROWS.map((row, i) => ({
                id: row.id,
                href: `/admin/ai-moderation?applied=${row.id}&days=1`,
                primary: String(counts[i]),
                badge: row.label,
                badgeKey: `aiModeration.dashboard_${row.id}`,
                badgeColor: BADGE_COLOR[row.id],
            })),
        }],
    });
}
