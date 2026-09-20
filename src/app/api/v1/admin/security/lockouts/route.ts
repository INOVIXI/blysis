/**
 * Who is locked out, and letting one of them back in.
 *
 * `lockedUntil` was read in one file and written in the same one, so a member
 * who fat-fingered their password past the threshold waited the lock out, and
 * the operator they wrote to had no way to help. The lock is a fact about an
 * account; this is how it is seen and lifted.
 *
 * Core's own, not a module's: the column, the counter and the sign-in that
 * clears them are core's, and a module rewriting an account's auth state
 * through the merged client would be a module holding the door.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { lockedAccounts, unlockAccount } from "@/core/lib/account-lockout";
import { logActivity } from "@/core/lib/activity-log";
import { readJsonBody } from "@/core/lib/api-body";

const unlockSchema = z.object({ userId: z.string().min(1).max(64) });

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const locked = await lockedAccounts();
    return NextResponse.json({
        locked: locked.map((one) => ({
            id: one.id,
            username: one.username,
            email: one.email,
            lockedUntil: one.lockedUntil.toISOString(),
            attempts: one.attempts,
            lastFailedAt: one.lastFailedAt ? one.lastFailedAt.toISOString() : null,
        })),
    });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = unlockSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
    }

    await unlockAccount(parsed.data.userId);

    // Lifting a lock is a change to somebody's ability to sign in, which is
    // the kind of thing an audit trail exists for.
    await logActivity({
        userId: session.user.id,
        action: "account.unlocked",
        entity: "user",
        entityId: parsed.data.userId,
    });

    return NextResponse.json({ ok: true });
}
