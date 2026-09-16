/**
 * Changing the address on an account, which is changing the account.
 *
 * A password reset goes to the address, so whoever controls the mailbox
 * controls the login. That makes this field unlike every other one on a
 * profile screen, and it is why the new address is not written when somebody
 * asks for it: it is held aside until a link sent to it comes back.
 *
 * A typo therefore costs nothing - the account keeps the address that works -
 * and somebody who types a stranger's address cannot take the account with it,
 * because the stranger is the one who gets the link.
 *
 * The address on file is told what was asked for. Somebody whose screen was
 * borrowed for a minute gets the only warning this kind of hijack ever gives.
 */

import { randomBytes, createHash } from "crypto";
import { prisma } from "./db";
import { readSettingValues } from "./setting-values";
import { sendEmailChangeVerification, sendEmailChangeNotice } from "./email";
import {
    MEMBER_EMAIL_CHANGES_KEY,
    EMAIL_CHANGE_VERIFICATION_KEY,
    memberEmailChanges,
    emailChangeVerification,
} from "./member-identity";

/** An hour. Long enough to find the mail, short enough that a stale one is dead. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/** The column is not the credential, the same way a session token's is not. */
function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export type EmailChangeRefusal =
    | "email_changes_closed"
    | "email_taken"
    | "email_unchanged"
    | "token_invalid"
    | "token_expired";

export type EmailChangeResult =
    | { ok: true; verified: boolean }
    | { ok: false; code: EmailChangeRefusal };

export interface EmailChangeRequest {
    userId: string;
    /** What the account answers to today, which is where the warning goes. */
    currentEmail: string;
    newEmail: string;
}

export async function requestEmailChange(request: EmailChangeRequest): Promise<EmailChangeResult> {
    const settings = await readSettingValues([MEMBER_EMAIL_CHANGES_KEY, EMAIL_CHANGE_VERIFICATION_KEY]);
    if (!memberEmailChanges(settings[MEMBER_EMAIL_CHANGES_KEY])) {
        return { ok: false, code: "email_changes_closed" };
    }

    const newEmail = request.newEmail.trim().toLowerCase();
    if (newEmail === request.currentEmail.trim().toLowerCase()) {
        return { ok: false, code: "email_unchanged" };
    }

    const taken = await prisma.user.findFirst({
        where: { email: newEmail, id: { not: request.userId } },
        select: { id: true },
    });
    if (taken) return { ok: false, code: "email_taken" };

    // An operator may decide their members are staff and the ceremony is not
    // worth it. Then the address moves at once - and loses its verified mark,
    // because nothing has proved the new one.
    if (!emailChangeVerification(settings[EMAIL_CHANGE_VERIFICATION_KEY])) {
        await prisma.user.update({
            where: { id: request.userId },
            data: { email: newEmail, emailVerified: null },
        });
        return { ok: true, verified: false };
    }

    const token = randomBytes(32).toString("hex");
    await prisma.emailChange.upsert({
        where: { userId: request.userId },
        create: {
            userId: request.userId,
            newEmail,
            token: hashToken(token),
            expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        },
        // Asking again replaces the row, so a link somebody mailed themselves
        // twice cannot be spent on the older address.
        update: {
            newEmail,
            token: hashToken(token),
            expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        },
    });

    await sendEmailChangeVerification(newEmail, token);
    await sendEmailChangeNotice(request.currentEmail, newEmail);

    return { ok: true, verified: true };
}

export async function confirmEmailChange(token: string): Promise<{ ok: true } | { ok: false; code: EmailChangeRefusal }> {
    const pending = await prisma.emailChange.findUnique({ where: { token: hashToken(token) } });
    if (!pending) return { ok: false, code: "token_invalid" };
    if (pending.expiresAt.getTime() <= Date.now()) return { ok: false, code: "token_expired" };

    // Somebody may have registered that address while the link sat in a
    // mailbox. Two accounts answering to one address is the state every reset
    // flow here assumes cannot happen.
    const taken = await prisma.user.findFirst({
        where: { email: pending.newEmail, id: { not: pending.userId } },
        select: { id: true },
    });
    if (taken) return { ok: false, code: "email_taken" };

    await prisma.user.update({
        where: { id: pending.userId },
        // Verified, and by the only thing that can verify it: the mailbox
        // answered.
        data: { email: pending.newEmail, emailVerified: new Date() },
    });
    await prisma.emailChange.delete({ where: { id: pending.id } });

    return { ok: true };
}
