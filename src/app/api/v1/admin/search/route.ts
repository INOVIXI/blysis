import { NextRequest, NextResponse } from "next/server";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { isAdmin } from "@/core/lib/permissions";
import { applyFiltersAsync } from "@/core/lib/hooks";

interface SearchResult {
    type: string;
    id: string;
    title: string;
    /**
     * Said in the reader's language by whoever draws this, where there is a
     * key for it. A module's name has one; a user's name does not.
     */
    titleKey?: string;
    subtitle?: string;
    href: string;
    icon?: string;
    score?: number;
}

/*
 * No screen is listed here any more.
 *
 * Twelve of the panel's own were, with English titles, under a comment saying
 * the list mirrors the sidebar's labels. It had drifted - the sidebar has four
 * times as many - and it answered only in English, so on a Turkish panel
 * "kullan" found nothing and "user" found one thing. Module screens fared
 * worse: they were scored on their URL and titled with its last segment, so a
 * search for "settings" answered with a column in which every row was an
 * identifier written twice, and one for "edit" offered a route pattern with
 * `[id]` still in it, an address no link can follow.
 *
 * Everything that names a screen is in the browser already: the navigation,
 * translated, and the registry it is built from. The palette reads those. What
 * is left here is what only the database knows - a member by name - and
 * whatever a module adds through `admin.search.results`.
 */

// GET /api/v1/admin/search?q=... - Cross-module spotlight search
export async function GET(request: NextRequest) {
    await ensureHooks();
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    if (q.length < 2) return NextResponse.json({ results: [] });

    const results: SearchResult[] = [];

    // 1. Users (top 5)
    try {
        const users = await prisma.user.findMany({
            where: { OR: [
                { username: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
            ] },
            select: { id: true, username: true, email: true },
            take: 5,
        });
        for (const u of users) {
            results.push({
                type: "user",
                id: u.id,
                title: u.username,
                subtitle: u.email,
                href: `/admin/users/${u.id}`,
                score: 50,
            });
        }
    } catch { /* ignore */ }

    // 2. Modules can extend via hook filter
    const extended = await applyFiltersAsync("admin.search.results", results, { query: q });

    // Sort by score, dedupe by href
    const seen = new Set<string>();
    const unique = extended
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .filter((r) => {
            if (seen.has(r.href)) return false;
            seen.add(r.href);
            return true;
        })
        .slice(0, 20);

    return NextResponse.json({ results: unique });
}
