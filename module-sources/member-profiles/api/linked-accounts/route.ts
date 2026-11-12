import { NextResponse } from "next/server";
import { auth } from "@/core/sdk/auth";
import { signInMethodsOf } from "@/core/sdk/server";
import { readLinkedAccounts } from "../../lib/read-linked-accounts";

/**
 * GET /api/v1/linked-accounts - the accounts this member has proved are theirs.
 *
 * It used to take a POST as well, and that POST was the only thing on the site
 * that ever wrote a link: a member typed an in-game name and it was recorded
 * as theirs and published on their profile, unchecked. The DELETE went with
 * it - a link is unmade where it was made, by the module that proved it and
 * knows what unmaking it costs.
 *
 * The sign-in methods the member connected ride beside them, for this tab
 * only. They are core's, and core cannot answer `profile.linkedAccounts`, so
 * this asks for them; `readLinkedAccounts` does not, because the public
 * profile reads through it and how somebody signs in is not a stranger's to
 * know. Each field is named so a wider row never reaches the page.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [accounts, methods] = await Promise.all([
        readLinkedAccounts(session.user.id),
        signInMethodsOf(session.user.id),
    ]);
    const signInMethods = methods.map((method) => ({
        provider: method.provider,
        providerAccountId: method.providerAccountId,
        displayName: method.displayName,
        connectedAt: method.connectedAt,
    }));
    return NextResponse.json({ accounts, signInMethods });
}
