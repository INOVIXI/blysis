import { prisma } from "./db";
import { LOCKOUT_DURATION, LOCKOUT_WINDOW, MAX_LOGIN_ATTEMPTS, getBounded, getDurationMs } from "./security-settings";
import { errorText, log } from "./logger";

/**
 * Progressive account lockout after repeated failed logins.
 *
 * IP-based rate limiting slows a single attacker host, but a distributed
 * credential-stuffing campaign can spray a victim account from thousands
 * of addresses without tripping any IP bucket. Per-account throttling is
 * the mitigation: every wrong password increments a counter; once the
 * counter crosses the attempt threshold inside the window, the account is
 * locked for the lock duration and further password checks short-circuit with the
 * same "invalid credentials" signal so the attacker gets no information
 * about why the attempt failed.
 *
 * A successful login always resets the counter - legitimate users who
 * mistype twice then get it right never see the lock.
 *
 * All three numbers are the operator's: how many wrong passwords it takes,
 * how long they are counted over, and how long the account then stays shut.
 * Each is a row clamped in `security-settings`, falling back to the
 * environment variable an install sets once and then to the built-in. Two of
 * them used to be environment-only, so a site wanting a ten minute window and
 * an hour's lock had to be redeployed to get one.
 *
 * They are read per attempt rather than at import, which is what makes a
 * change on the screen take on the next failed sign-in instead of the next
 * restart.
 */

export interface LockoutStatus {
    locked: boolean;
    /** Unix ms timestamp when the lock lifts. Undefined when not locked. */
    until?: number;
}

/**
 * Check whether the account is currently locked out. Called before password
 * verification so a locked account short-circuits without spending bcrypt.
 */
export function getLockoutStatus(user: {
    lockedUntil: Date | null;
} | null | undefined): LockoutStatus {
    if (!user?.lockedUntil) return { locked: false };
    const until = user.lockedUntil.getTime();
    if (until <= Date.now()) return { locked: false };
    return { locked: true, until };
}

/**
 * Called after a failed password attempt. Increments the counter and
 * arms the lock when the threshold is reached. Any prior failure older
 * than the window resets the counter before incrementing so a user with
 * three fumbled logins a month apart never gets locked.
 */
export async function registerFailedLogin(
    userId: string,
    context?: { ip?: string },
): Promise<void> {
    try {
        const existing = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                failedLoginAttempts: true,
                lastFailedLoginAt: true,
                lockedUntil: true,
                email: true,
                username: true,
                locale: true,
            },
        });
        if (!existing) return;

        const now = Date.now();
        const lastAt = existing.lastFailedLoginAt?.getTime() ?? 0;
        const [windowMs, lockMs, threshold] = await Promise.all([
            getDurationMs(LOCKOUT_WINDOW),
            getDurationMs(LOCKOUT_DURATION),
            getBounded(MAX_LOGIN_ATTEMPTS),
        ]);
        // Strictly less-than: a failure landing exactly one window after the
        // last one starts a fresh window rather than straddling the boundary.
        // Matches the semantics documented above ("older than the window
        // resets the counter").
        const withinWindow = now - lastAt < windowMs;
        const nextAttempts = (withinWindow ? existing.failedLoginAttempts : 0) + 1;
        const shouldLock = nextAttempts >= threshold;
        const alreadyLocked = (existing.lockedUntil?.getTime() ?? 0) > now;
        const lockedUntil = shouldLock ? new Date(now + lockMs) : existing.lockedUntil;

        await prisma.user.update({
            where: { id: userId },
            data: {
                failedLoginAttempts: nextAttempts,
                lastFailedLoginAt: new Date(now),
                lockedUntil,
            },
        });

        // Fire an early-warning email the first time we cross the threshold
        // within a window. Subsequent attempts while already locked don't
        // re-send - that would turn a slow brute-force into an email bomb.
        if (shouldLock && !alreadyLocked && existing.email) {
            try {
                const { sendAccountLockoutEmail } = await import("./email");
                await sendAccountLockoutEmail({
                    to: existing.email,
                    username: existing.username,
                    unlocksAt: lockedUntil!,
                    ip: context?.ip,
                    locale: existing.locale ?? undefined,
                });
            } catch (err) {
                log.error("[account-lockout] lockout notification failed", { error: errorText(err) });
            }
        }
    } catch (err) {
        log.error("[account-lockout] registerFailedLogin failed", { error: errorText(err) });
    }
}

/**
 * Called after a successful login. Resets the failure counter + clears
 * any residual lock so the next legitimate login is never accidentally
 * blocked by an old stale state.
 */
export async function resetFailedLogins(userId: string): Promise<void> {
    try {
        await prisma.user.update({
            where: { id: userId },
            data: {
                failedLoginAttempts: 0,
                lastFailedLoginAt: null,
                lockedUntil: null,
            },
        });
    } catch (err) {
        log.error("[account-lockout] resetFailedLogins failed", { error: errorText(err) });
    }
}

/** What a locked account looks like to whoever is going to let it back in. */
export interface LockedAccount {
    id: string;
    username: string;
    email: string;
    lockedUntil: Date;
    attempts: number;
    lastFailedAt: Date | null;
}

/**
 * Who is shut out right now.
 *
 * `lockedUntil` was read in one file and written in the same one, so nothing
 * showed an operator who was locked out: a member who fat-fingered their
 * password ten times waited it out, and the person they wrote to had no way
 * to help. The lock is a fact about an account and this is how it is seen.
 *
 * Bounded, because an attack on a site is an attack on many accounts at once
 * and a list with no ceiling is the wrong thing to open under one.
 */
export async function lockedAccounts(limit = 200): Promise<LockedAccount[]> {
    const rows = await prisma.user.findMany({
        where: { lockedUntil: { gt: new Date() } },
        select: {
            id: true,
            username: true,
            email: true,
            lockedUntil: true,
            failedLoginAttempts: true,
            lastFailedLoginAt: true,
        },
        orderBy: { lockedUntil: "desc" },
        take: limit,
    });
    return rows.map((row) => ({
        id: row.id,
        username: row.username,
        email: row.email,
        lockedUntil: row.lockedUntil as Date,
        attempts: row.failedLoginAttempts,
        lastFailedAt: row.lastFailedLoginAt,
    }));
}

/**
 * Let somebody back in.
 *
 * The same write a successful sign-in makes, deliberately: two ways of
 * clearing a lock that differ by a field is a difference nobody remembers,
 * and the account is in exactly the state it would be in had the member
 * remembered their password.
 */
export async function unlockAccount(userId: string): Promise<void> {
    await resetFailedLogins(userId);
}

export const ACCOUNT_LOCKOUT_CONFIG = {
    /** Defaults only. The effective numbers are the operator's rows. */
    MAX_ATTEMPTS: MAX_LOGIN_ATTEMPTS.defaultValue,
    MAX_WINDOW_MS: LOCKOUT_WINDOW.defaultValue * LOCKOUT_WINDOW.unitMs,
    LOCKOUT_MS: LOCKOUT_DURATION.defaultValue * LOCKOUT_DURATION.unitMs,
};
