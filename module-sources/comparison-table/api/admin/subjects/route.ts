import { NextResponse } from "next/server";
import { applyFiltersAsync } from "@/core/sdk";
import { isAdmin } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

/**
 * GET /api/v1/comparison-tables/admin/subjects
 *
 * Everything a table could be built about, asked of whoever owns it.
 *
 * This module does not know what any of them are - it gets a reference, a name
 * to show, and a word to group the list by. The shop answers with its shelves;
 * something else answers with its own tomorrow and nothing here changes.
 *
 * Admin-only because the list is a map of what the site sells, grouped and
 * named, which is not a thing to hand to anybody who asks.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const subjects = await applyFiltersAsync("comparison.subjects", [], {});
    return NextResponse.json({ subjects }, { headers: { "Cache-Control": "private, no-store" } });
}
