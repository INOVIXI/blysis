import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { logActivity } from "@/core/lib/activity-log";
import { disconnectSignInMethod } from "@/core/lib/sign-in-methods";

type RouteParams = { params: Promise<{ id: string; provider: string }> };

/**
 * DELETE - an operator removing a sign-in method from a member, the way out
 * of a provider account somebody else got hold of. It keeps the member's own
 * rule: the last way into an account is not removed, because an account
 * nobody can sign in to is one only the database can give back. Banning or
 * deleting the member is the tool for an account that should be shut.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id, provider } = await params;
    const result = await disconnectSignInMethod(id, provider);
    if (!result.ok) {
        return result.code === "not_found"
            ? NextResponse.json({ error: "Not found", code: "not_found" }, { status: 404 })
            : NextResponse.json({ error: "This is the only way into the account", code: result.code }, { status: 409 });
    }

    logActivity({
        userId: session.user.id,
        action: "admin.user.sign_in_method.remove",
        entity: "user",
        entityId: id,
        metadata: { provider },
    }).catch(() => {});

    return NextResponse.json({ ok: true });
}
