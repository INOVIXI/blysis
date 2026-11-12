import { NextResponse } from "next/server";
import { isAdmin } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { refreshRates } from "../../../lib/rate-refresh";

/**
 * A refresh now, whatever the interval says.
 *
 * For an operator who just changed the order or entered a key and wants to
 * see whether it works without waiting for the next run. The answer is the
 * same outcome the scheduled run records: failures are codes, never a URL,
 * so a key cannot come back in it.
 */
export async function POST() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(await refreshRates({ force: true }));
}
