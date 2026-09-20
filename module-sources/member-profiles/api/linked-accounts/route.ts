import { NextResponse } from "next/server";
import { auth } from "@/core/sdk/auth";
import { readLinkedAccounts } from "../../lib/read-linked-accounts";

/**
 * GET /api/v1/linked-accounts - the accounts this member has proved are theirs.
 *
 * It used to take a POST as well, and that POST was the only thing on the site
 * that ever wrote a link: a member typed an in-game name and it was recorded
 * as theirs and published on their profile, unchecked. The DELETE went with
 * it - a link is unmade where it was made, by the module that proved it and
 * knows what unmaking it costs.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const accounts = await readLinkedAccounts(session.user.id);
    return NextResponse.json({ accounts });
}
