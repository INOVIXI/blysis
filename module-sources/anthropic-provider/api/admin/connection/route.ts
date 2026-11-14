import { NextResponse } from "next/server";
import { isAdmin } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { tryConnection } from "../../../lib/provider";

/**
 * Try the stored key, and answer with the models it may use.
 *
 * It tries what is saved, not what is typed: a key reaches the server only
 * through the settings form, which encrypts it, and a second way in would be
 * a second place to get that wrong. The screen says to save first.
 */
export async function POST() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const outcome = await tryConnection();
    if (outcome.ok) {
        return NextResponse.json({ ok: true, models: outcome.models }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json(
        { error: "The connection did not work", code: outcome.problem },
        { status: outcome.problem === "not_configured" ? 400 : 502 },
    );
}
