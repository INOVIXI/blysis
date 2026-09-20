/**
 * GET /api/v1/themes/marketplace - what an operator may install.
 *
 * One screen reads this: Admin > Settings > Theme. It answered anybody until
 * an audit on 2026-09-20 asked the question of reads that was already being
 * asked of writes, and the same reasoning applies as to the module catalogue
 * beside it: the list is about this site's admin surface, and fetching it
 * sends the site out to a remote index.
 *
 * The cache stays in front of that fetch and is deliberately process-wide
 * rather than per caller: it is there to spare the registry, not the reader.
 *
 * The first-run wizard has its own copy at /api/setup/themes, gated on setup
 * being incomplete, because during setup there is no operator to check.
 */
import { NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { hasPermission } from "@/core/lib/permissions";
import { themeMarketplaceIndexUrl } from "@/core/lib/marketplace-source";

let cached: Record<string, unknown> | null = null;
let cacheTime = 0;

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "admin.themes"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = Date.now();
    if (cached && now - cacheTime < 300000) return NextResponse.json(cached);

    try {
        const res = await fetch(themeMarketplaceIndexUrl(), { next: { revalidate: 300 } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        cached = data;
        cacheTime = now;
        return NextResponse.json(data);
    } catch {
        if (cached) return NextResponse.json(cached);
        // An empty list under a 502 reads as "there is nothing to install"
        // rather than "the registry could not be reached", and the screen has
        // no way to tell the two apart without a word for it.
        return NextResponse.json(
            { themes: [], error: "The theme registry could not be reached" },
            { status: 502 },
        );
    }
}
