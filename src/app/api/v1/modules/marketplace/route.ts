/**
 * GET /api/v1/modules/marketplace - what an operator may install.
 *
 * One screen reads this: Admin > Modules. It answered anybody until an audit
 * on 2026-09-20 asked the question of reads that was already being asked of
 * writes - so the full list of everything this site can run, with versions and
 * descriptions, was available to a stranger, and asking for it made the site
 * go and fetch a remote index.
 *
 * The permission is the one the install endpoint beside it answers to, minus
 * the installing: seeing the catalogue is the job of whoever manages modules.
 *
 * The first-run wizard has its own copy at /api/setup/modules, gated on setup
 * being incomplete, because during setup there is no operator to check.
 */
import { NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { hasPermission } from "@/core/lib/permissions";
import { loadMarketplaceCatalog } from "./_catalog";

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "admin.modules"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
        return NextResponse.json(await loadMarketplaceCatalog());
    } catch {
        return NextResponse.json(
            { modules: [], error: "Failed to fetch marketplace" },
            { status: 502 },
        );
    }
}
