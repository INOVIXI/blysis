import { NextRequest, NextResponse } from "next/server";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";
import { z } from "zod";
import { readJsonBody } from "@/core/lib/api-body";
import { prisma } from "@/core/lib/db";
import { createHash } from "crypto";
import { hashPassword } from "@/core/lib/password-hash";
import { getHashAlgorithm } from "@/core/lib/security-settings";
import { rateLimit, getClientIP } from "@/core/lib/rate-limit";
import { logActivity } from "@/core/lib/activity-log";
import { checkPasswordBreach } from "@/core/lib/password-breach";
import { enforcePasswordPolicy } from "@/core/lib/security-settings";
import { log } from "@/core/lib/logger";
import { revokeSessionsFor } from "@/core/lib/session-registry";
import { accountFor } from "@/core/lib/login-identifier";

/**
 * The three fields a reset carries. `password` is bounded here only so an
 * absurd one never reaches bcrypt; the policy and breach checks below decide
 * whether it is acceptable.
 */
const resetPasswordSchema = z.object({
    email: z.string().min(1).max(254),
    token: z.string().min(1).max(256),
    password: z.string().min(1).max(200),
});

// POST /api/v1/auth/reset-password
export async function POST(request: NextRequest) {
    await ensureHooks();
    try {
        const ip = getClientIP(request.headers);
        const rl = await rateLimit(`reset:${ip}`, { maxRequests: 10, windowMs: 3600000 });
        if (!rl.success) {
            return NextResponse.json({ error: "Too many attempts. Try again later.", code: "rate_limited" }, { status: 429 });
        }

        const raw = await readJsonBody(request, { fallback: {} });
        if (raw instanceof NextResponse) return raw;
        const parsed = resetPasswordSchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json({ error: "Missing required fields", code: "missing_fields" }, { status: 400 });
        }
        const email = parsed.data.email.trim().toLowerCase();
        const { token, password } = parsed.data;

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

        // The DB stores the SHA-256 digest of the plaintext reset token we
        // mailed to the user. Hash the incoming value before lookup so the
        // plaintext never hits Prisma (and a DB dump yields only hashes).
        const tokenHash = createHash("sha256").update(token).digest("hex");

        // Atomically consume the token. `deleteMany` runs as a single SQL
        // statement, so two concurrent requests racing on the same token
        // cannot both see `count = 1` - exactly one wins, the other gets 0
        // and is rejected as an invalid token. This replaces the previous
        // findFirst → update → deleteMany pattern that allowed a narrow
        // window for the same token to be used twice.
        const { count: consumed } = await prisma.verificationToken.deleteMany({
            where: {
                identifier: email,
                token: tokenHash,
                expires: { gt: new Date() },
            },
        });

        if (consumed === 0) {
            return NextResponse.json({ error: "Invalid or expired reset token", code: "invalid_token" }, { status: 400 });
        }

        // The token was issued for the lowercased address; the account may
        // have registered it with capitals. Found the way sign-in finds it.
        const account = await accountFor({ email }, prisma);
        const user = account ? await prisma.user.findUnique({ where: { id: account.id } }) : null;
        if (!user || user.isBanned || user.isDeleted) {
            return NextResponse.json({ error: "Invalid or expired reset token", code: "invalid_token" }, { status: 400 });
        }

        const hashedPassword = await hashPassword(password, await getHashAlgorithm());

        await prisma.user.update({
            where: { id: user.id },
            data: { password: hashedPassword },
        });

        // Also invalidate any *other* active reset tokens for this account
        // so an attacker holding a second token can't use it after the
        // password changes. The winning token is already gone.
        await prisma.verificationToken.deleteMany({ where: { identifier: email } });

        // A reset is what somebody does when they believe their account is
        // compromised, and under the JWT strategy a cookie the intruder
        // already holds is not asked about the password again. Nothing is
        // spared: the person resetting is not signed in.
        await revokeSessionsFor(user.id, null);

        await logActivity({ userId: user.id, action: "password.reset", entity: "user", entityId: user.id }).catch(() => {});

        import("@/core/lib/hooks")
            .then(({ doActionAsync }) =>
                doActionAsync("user.password.changed", { userId: user.id })
            )
            .catch(() => {});

        return NextResponse.json({ message: "Password has been reset successfully" });
    } catch (error) {
        log.error("Reset password error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: "Internal server error", code: "server_error" }, { status: 500 });
    }
}
