/**
 * GET /api/v1/announcements/admin - every notice, live or not.
 *
 * A route of its own rather than a `scope=admin` branch on the public one.
 * That endpoint answers the same thing to everybody and offers it to a shared
 * cache for thirty seconds, which is worth keeping: it is asked on every page
 * load. An answer that varies by who asked cannot sit behind that header, and
 * the rule is not worth betting a private answer on a proxy's idea of a cache
 * key.
 */
import { NextResponse } from "next/server";
import { isAdmin, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const announcements = await prisma.announcement.findMany({
        orderBy: { createdAt: "desc" },
        // A ceiling rather than a page: this list is what one operator wrote,
        // and a site with five hundred notices has a different problem.
        take: 500,
    });
    return NextResponse.json({ announcements });
}
