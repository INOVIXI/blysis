import { NextResponse } from "next/server";
import { applyFiltersAsync } from "@/core/sdk";
import { hasPermission } from "@/core/sdk/server";
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
 * What a reward may hand over and what a crate's key may be, asked of
 * whichever modules own things through `grantable.options`. The crate never
 * reads the store's table: it holds an id the store gave it and hands it back.
 */
export async function GET() {
    const refused = await refuse();
    if (refused) return refused;

    const options = await applyFiltersAsync("grantable.options", [], {});
    return NextResponse.json({ grantables: options }, { headers: PRIVATE });
}
