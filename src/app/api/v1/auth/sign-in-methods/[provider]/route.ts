import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { logActivity } from "@/core/lib/activity-log";
import { rateLimitForRoleAsync } from "@/core/lib/rate-limit";
import { disconnectSignInMethod } from "@/core/lib/sign-in-methods";

type RouteParams = { params: Promise<{ provider: string }> };

/**
 * DELETE - remove one of the member's own sign-in methods. Refused when it is
 * the last way into the account; see `disconnectRefusal`.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });

    const allowed = await rateLimitForRoleAsync(
        `sign-in-method-disconnect:${session.user.id}`,
        { maxRequests: 30, windowMs: 60_000 },
        session.user.role,
    );
    if (!allowed) {
        return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });
    }

    const { provider } = await params;
    const result = await disconnectSignInMethod(session.user.id, provider);
    if (!result.ok) {
        return result.code === "not_found"
            ? NextResponse.json({ error: "Not found", code: "sign_in_method_not_found" }, { status: 404 })
            : NextResponse.json({ error: "This is the only way into the account", code: "last_sign_in_method" }, { status: 409 });
    }

    logActivity({
        userId: session.user.id,
        action: "user.sign_in_method.disconnect",
        entity: "account",
        entityId: provider,
        metadata: { provider },
    }).catch(() => {});

    return NextResponse.json({ ok: true });
}
