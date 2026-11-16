import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/core/lib/auth";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";
import { isAdmin } from "@/core/lib/permissions";
import { prisma } from "@/core/lib/db";
import { readJsonBody } from "@/core/lib/api-body";
import { hashPassword } from "@/core/lib/password-hash";
import { enforcePasswordPolicy, getHashAlgorithm } from "@/core/lib/security-settings";
import { checkPasswordBreach } from "@/core/lib/password-breach";
import { revokeSessionsFor } from "@/core/lib/session-registry";
import { logActivity } from "@/core/lib/activity-log";
import { log } from "@/core/lib/logger";

/**
 * `password` is bounded here only so an absurd one never reaches the hash;
 * the policy and breach checks below decide whether it is acceptable.
 */
const setPasswordSchema = z.object({
    password: z.string().min(1).max(200),
});

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST - an administrator gives a member a new password.
 *
 * A member who forgot theirs resets it by mail, and a fresh site often has no
 * mail set up, so this is the way back in that does not depend on it. It is
 * held to what a member's own password is held to, and it ends every session
 * the member has: whoever asked for it may be somebody whose account another
 * person is using. Another administrator's password, the caller's included,
 * is refused: an administrator changes their own from their profile, and the
 * panel is not a way into an equal's account.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
    await ensureHooks();
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    try {
        const { id } = await params;
        const body = await readJsonBody(request);
        if (body instanceof NextResponse) return body;
        const parsed = setPasswordSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: "A password is required", code: "missing_fields" }, { status: 400 });
        }
        const { password } = parsed.data;

        const user = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, isDeleted: true } });
        if (!user || user.isDeleted) {
            return NextResponse.json({ error: "User not found", code: "not_found" }, { status: 404 });
        }
        if (await isAdmin(user.id)) {
            return NextResponse.json(
                { error: "An administrator changes their own password", code: "administrator_password" },
                { status: 403 },
            );
        }

        const policyCheck = await enforcePasswordPolicy(password);
        if (!policyCheck.ok) {
            return NextResponse.json(
                { error: policyCheck.message ?? "Invalid password", code: "weak_password" },
                { status: 400 },
            );
        }
        const breach = await checkPasswordBreach(password);
        if (!breach.ok) {
            return NextResponse.json(
                { error: "This password has appeared in a known data breach - pick something else.", code: "password_breached" },
                { status: 400 },
            );
        }

        const hashedPassword = await hashPassword(password, await getHashAlgorithm());
        await prisma.user.update({
            where: { id: user.id },
            data: { password: hashedPassword },
        });

        // Under the JWT strategy a cookie is not asked about the password
        // again, so a session somebody else holds would outlive the change.
        // Nothing is spared: the member is not the one making it.
        await revokeSessionsFor(user.id, null);

        logActivity({
            userId: session.user.id,
            action: "admin.user.password.set",
            entity: "user",
            entityId: user.id,
            metadata: { targetUsername: user.username },
        }).catch(() => {});

        import("@/core/lib/hooks")
            .then(({ doActionAsync }) => doActionAsync("user.password.changed", { userId: user.id }))
            .catch(() => {});

        return NextResponse.json({ ok: true });
    } catch (error) {
        log.error("Admin set password error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: "Internal server error", code: "server_error" }, { status: 500 });
    }
}
