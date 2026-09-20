import { NextRequest, NextResponse } from "next/server";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { rateLimit } from "@/core/lib/rate-limit";
import { enforcePasswordPolicy } from "@/core/lib/security-settings";
import { updateUserSchema, updatePasswordSchema } from "@/core/lib/validations";
import { hashPassword, verifyPassword } from "@/core/lib/password-hash";
import { readSettingValues } from "@/core/lib/setting-values";
import { MEMBER_AVATAR_UPLOADS_KEY, memberAvatarsAllowed } from "@/core/lib/member-uploads";
import { requestEmailChange } from "@/core/lib/email-change";
/** What proves the person at the screen is the account's owner. */
const identityProofSchema = z.object({ currentPassword: z.string().min(1).max(200).optional() });

import {
    MEMBER_USERNAME_CHANGES_KEY,
    IDENTITY_REQUIRES_PASSWORD_KEY,
    memberUsernameChanges,
    identityRequiresPassword,
} from "@/core/lib/member-identity";
import { getHashAlgorithm } from "@/core/lib/security-settings";
import { readJsonBody } from "@/core/lib/api-body";
import { z } from "zod";
import { callerSessionTokenId, revokeSessionsFor } from "@/core/lib/session-registry";

// GET /api/v1/auth/profile
export async function GET() {
    await ensureHooks();
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
            id: true,
            email: true,
            username: true,
            avatar: true,
            locale: true,
            currency: true,
            createdAt: true,
            // The id and the declarations too: a screen drawing a role
            // without them draws the colour and silently ignores
            // whatever the operator actually wrote.
            role: { select: { id: true, name: true, displayName: true, color: true, nameCss: true, badgeCss: true } },
        },
    });

    return NextResponse.json({ user });
}

// PATCH /api/v1/auth/profile - Update profile
export async function PATCH(request: NextRequest) {
    await ensureHooks();
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    // Password change
    const passwordFields = z
        .object({ currentPassword: z.string().optional(), newPassword: z.string().optional() })
        .safeParse(body);
    if (passwordFields.success && passwordFields.data.currentPassword && passwordFields.data.newPassword) {
        // `bcrypt.compare` below turns this branch into a password oracle, and
        // one bcrypt round at cost 12 per request is a CPU sink besides. The
        // account deletion route has always had this ceiling; the branch that
        // changes the password did not.
        const rl = await rateLimit(`profile-password:${session.user.id}`, {
            maxRequests: 5,
            windowMs: 15 * 60 * 1000,
        });
        if (!rl.success) {
            return NextResponse.json(
                { error: "Too many attempts. Try again later.", code: "rate_limited" },
                { status: 429 },
            );
        }

        const validation = updatePasswordSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json({ error: validation.error.issues[0].message, code: "invalid_input" }, { status: 400 });
        }

        const policyCheck = await enforcePasswordPolicy(validation.data.newPassword);
        if (!policyCheck.ok) {
            return NextResponse.json({ error: policyCheck.message ?? "Invalid password", code: "weak_password" }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { id: session.user.id } });
        if (!user?.password) {
            return NextResponse.json({ error: "Cannot change password for OAuth accounts", code: "oauth_password_change" }, { status: 400 });
        }

        const isValid = await verifyPassword(validation.data.currentPassword, user.password);
        if (!isValid) {
            return NextResponse.json({ error: "Current password is incorrect", code: "wrong_password" }, { status: 400 });
        }

        const hashedPassword = await hashPassword(validation.data.newPassword, await getHashAlgorithm());
        await prisma.user.update({
            where: { id: session.user.id },
            data: { password: hashedPassword },
        });

        // Every other session ends. The one on this request survives, so a
        // user who has just changed their own password is not thrown out of
        // the page they did it on; anything else signed in with the old
        // password stops working on its next recheck.
        await revokeSessionsFor(session.user.id, await callerSessionTokenId(request));

        // Fire user.password.changed hook
        import("@/core/lib/hooks")
            .then(({ doActionAsync }) =>
                doActionAsync("user.password.changed", { userId: session.user.id })
            )
            .catch(() => {});

        return NextResponse.json({ message: "Password updated" });
    }

    // Profile update
    const validation = updateUserSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0].message, code: "invalid_input" }, { status: 400 });
    }

    const settings = await readSettingValues([
        MEMBER_USERNAME_CHANGES_KEY,
        IDENTITY_REQUIRES_PASSWORD_KEY,
    ]);

    // Changing who you are asks for the password that proves you are them.
    // Somebody who walks up to an unlocked screen should not be able to take
    // the account by rewriting one field.
    const identityFields = validation.data.username !== undefined || validation.data.email !== undefined;
    if (identityFields && identityRequiresPassword(settings[IDENTITY_REQUIRES_PASSWORD_KEY])) {
        // Through a schema, like every other field a caller sends. Read raw,
        // a body is whatever arrived: `bodies-are-narrowed` exists because a
        // handler that trusts its shape is one cast away from trusting its
        // contents.
        const proof = identityProofSchema.safeParse(body);
        const supplied = proof.success ? proof.data.currentPassword ?? "" : "";
        const account = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { password: true },
        });
        // An account created through a provider has no password to check, and
        // asking for one it never had would lock those members out of their
        // own name for ever.
        if (account?.password) {
            if (!supplied || !(await verifyPassword(supplied, account.password))) {
                return NextResponse.json(
                    { error: "Current password is incorrect", code: "wrong_password" },
                    { status: 400 },
                );
            }
        }
    }

    if (validation.data.email !== undefined) {
        const current = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { email: true },
        });
        const outcome = await requestEmailChange({
            userId: session.user.id,
            currentEmail: current?.email ?? "",
            newEmail: validation.data.email,
        });
        if (!outcome.ok) {
            return NextResponse.json({ error: "Email not changed", code: outcome.code }, { status: 400 });
        }
        if (outcome.verified) {
            return NextResponse.json({ message: "Confirmation sent", code: "email_change_pending" });
        }
    }

    const data: Record<string, unknown> = {};
    if (validation.data.username) {
        if (!memberUsernameChanges(settings[MEMBER_USERNAME_CHANGES_KEY])) {
            return NextResponse.json(
                { error: "Username changes are closed", code: "username_changes_closed" },
                { status: 403 },
            );
        }
        const existing = await prisma.user.findFirst({
            where: { username: validation.data.username, id: { not: session.user.id } },
        });
        if (existing) {
            return NextResponse.json({ error: "Username already taken", code: "username_taken" }, { status: 400 });
        }
        data.username = validation.data.username;
    }
    if (validation.data.avatar !== undefined) {
        // A site that wants no member pictures means none: closing the upload
        // door while a pasted address still works is a policy with a hole in
        // it, and the screen stops offering the field either way.
        const policy = await readSettingValues([MEMBER_AVATAR_UPLOADS_KEY]);
        if (validation.data.avatar && !memberAvatarsAllowed(policy[MEMBER_AVATAR_UPLOADS_KEY])) {
            return NextResponse.json(
                { error: "Member pictures are turned off", code: "avatars_closed" },
                { status: 403 },
            );
        }
        data.avatar = validation.data.avatar;
    }
    if (validation.data.locale) data.locale = validation.data.locale;
    if (validation.data.currency) data.currency = validation.data.currency;

    const user = await prisma.user.update({
        where: { id: session.user.id },
        data,
        select: { id: true, username: true, avatar: true, locale: true, currency: true },
    });

    // Fire user.profile.updated hook - modules can react (audit, sync, etc.)
    import("@/core/lib/hooks")
        .then(({ doActionAsync }) =>
            doActionAsync("user.profile.updated", {
                userId: session.user.id,
                changes: data,
            })
        )
        .catch(() => {});

    return NextResponse.json({ user });
}
