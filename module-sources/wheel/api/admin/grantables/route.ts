import { NextResponse } from "next/server";
import { hasPermission } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { applyFiltersAsync } from "@/core/sdk";

/**
 * What an operator may set a prize to hand over.
 *
 * The wheel has no idea what a thing is. It asks `grantable.options`, and
 * whichever modules own things answer with a name and an id that means
 * something to them - a shop with its products, and anything else installed
 * later without this endpoint changing.
 *
 * Answered here rather than by the picker calling a shop endpoint directly,
 * because the form has no business knowing which module is installed: a panel
 * whose fields appear and disappear with the module list is a panel that has
 * to be read twice.
 */

/** This answer depends on who asked, so nothing may keep a copy of it. */
const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
    }
    if (!(await hasPermission(session.user.id, "wheel.manage"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE });
    }

    // The bus is filled by core's dispatcher before it reaches here; a route
    // that fires a filter on a graph nobody bootstrapped gets its own
    // argument back, and the tell is a fast response with an empty list.
    const options = await applyFiltersAsync("grantable.options", [], {});

    return NextResponse.json({ grantables: options }, { headers: PRIVATE });
}
