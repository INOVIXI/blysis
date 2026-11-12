/**
 * Where a signed-in device is written down.
 *
 * Under the JWT strategy the cookie is the session, so the only server-side
 * trace of a device is a `UserSession` row keyed by the `tokenId` claim the
 * token carries. Five places read that table: the profile's device list, the
 * two revoke endpoints, the `jwt` callback's revocation check, and the staff
 * module's "who is online". Nothing wrote to it. The row was never created, so
 * the list was empty for everyone, both revoke buttons updated zero rows, and
 * `isRevoked` could not become true no matter what a user clicked.
 *
 * Both calls here are best-effort on purpose. A device record is not what the
 * user asked for when they signed in, and refusing the sign-in because the
 * write failed would turn a degraded feature into an outage. A failed write is
 * logged as an error rather than a warning, because the user walks away
 * holding a session that "sign out everywhere" cannot reach.
 */
import { prisma } from "./db";
import { log, errorText } from "./logger";

import { SECURE_SESSION_COOKIES, SESSION_TOKEN_COOKIE } from "./session-cookie";

/**
 * How many devices the sessions screen lists.
 *
 * A row is written per sign-in and lives until its token expires, and nothing
 * dedupes a browser that signs in twice, so the count follows logins rather
 * than devices. Fifty is more than a person has and few enough that the
 * response stays a screenful; the oldest-active fall off the end.
 */
export const MAX_LISTED_DEVICES = 50;

/**
 * How stale "last active" may get.
 *
 * The screen renders it as a date and a time and nobody reads it to the
 * minute, so refreshing it on every recheck bought nothing and cost a write
 * per session per minute per worker. Fifteen minutes is invisible on the
 * screen and fifteen times cheaper.
 */
export const SESSION_TOUCH_INTERVAL_MS = 15 * 60_000;

export interface SignInRecord {
    /** The `tokenId` claim in the JWT; the key every revocation check uses. */
    tokenId: string;
    userId: string;
    /** When the token stops being accepted, so the row can be pruned with it. */
    expiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
}

/**
 * Record a device against a sign-in.
 *
 * `deviceInfo` is deliberately left unset: the sessions screen renders it
 * verbatim when present, so a label written on the server would arrive in one
 * language on a screen that has two. The client derives a label from the user
 * agent through its own translations.
 */
export async function recordSignIn(record: SignInRecord): Promise<void> {
    try {
        await prisma.userSession.create({
            data: {
                tokenId: record.tokenId,
                userId: record.userId,
                expiresAt: record.expiresAt,
                ipAddress: record.ipAddress,
                userAgent: record.userAgent,
            },
        });
    } catch (err) {
        log.error("[sessions] could not record a signed-in device", { error: errorText(err) });
    }
}

/**
 * Move a session's `lastActiveAt` forward, if it has fallen far enough behind.
 *
 * `updateMany` rather than `update` because a token minted before this file
 * existed has no row, and that is not a failure: it must not throw and it must
 * not be logged on every request for the life of that cookie.
 *
 * The `lastActiveAt` condition is what keeps several workers from each writing
 * the same row: only one of them finds it stale, and the rest write nothing.
 */
export async function touchSession(tokenId: string, at: Date = new Date()): Promise<void> {
    try {
        await prisma.userSession.updateMany({
            where: { tokenId, lastActiveAt: { lt: new Date(at.getTime() - SESSION_TOUCH_INTERVAL_MS) } },
            data: { lastActiveAt: at },
        });
    } catch (err) {
        log.error("[sessions] could not refresh a device's last activity", { error: errorText(err) });
    }
}

/**
 * Which of a user's sessions a password change ends.
 *
 * Written as a `where` rather than performed here so the rule is one testable
 * expression: two callers need it and both must mean the same thing by it.
 * `spared` is the tokenId of the session making the change; a reset has none,
 * because the person doing it is not signed in.
 *
 * An unnamed session is not spared. A token that would not decode is not
 * evidence of anything, and sparing it on a guess costs the whole point of
 * the change - where ending it costs one sign-in.
 */
export function sessionsToRevoke(
    userId: string,
    spared: string | null,
): { userId: string; isRevoked: false; tokenId?: { not: string } } {
    const base = { userId, isRevoked: false as const };
    return spared ? { ...base, tokenId: { not: spared } } : base;
}

/**
 * End every session this password was protecting, sparing the one changing it.
 *
 * Best effort by design, and logged as an error when it fails. The password is
 * already written by the time this runs, so throwing would tell the user their
 * change did not happen when it did - and leave them believing the old one
 * still works. What is lost on a failure is the revocation, which "sign out
 * everywhere" can still do by hand.
 *
 * It takes effect on the next session recheck rather than instantly, the same
 * bound a ban has.
 */
export async function revokeSessionsFor(userId: string, spared: string | null): Promise<number> {
    try {
        const { count } = await prisma.userSession.updateMany({
            where: sessionsToRevoke(userId, spared),
            data: { isRevoked: true },
        });
        return count;
    } catch (error) {
        log.error("[sessions] could not revoke sessions after a password change", {
            userId,
            error: errorText(error),
        });
        return 0;
    }
}

/**
 * The decoded session token the request carries, or null.
 *
 * Decoded only: a token that decodes can still be revoked or past its own
 * deadline, which is the `jwt` callback's question. It is read here because
 * Auth.js reads the same cookie the same way when an OAuth sign-in comes back
 * (`handleLoginOrRegister` links to its `sub`), and the sign-in callback has
 * to know who that will be before it happens.
 *
 * The name comes from session-cookie.ts, which is also where auth.ts gets it,
 * so the reader and the issuer cannot disagree about the prefix.
 */
export async function callerToken(source: { headers: Headers }): Promise<Record<string, unknown> | null> {
    try {
        const { getToken } = await import("next-auth/jwt");
        const token = await getToken({
            // getToken reads `req.cookies` or the Cookie header; a Request has
            // the header, which is what the app's own handlers receive.
            req: source as unknown as Parameters<typeof getToken>[0]["req"],
            secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
            secureCookie: SECURE_SESSION_COOKIES,
            cookieName: SESSION_TOKEN_COOKIE,
        });
        return token && typeof token === "object" ? (token as Record<string, unknown>) : null;
    } catch (error) {
        // Unreadable is treated as unknown, which spares nothing and links nothing.
        log.warn("[sessions] could not read the caller's session token", { error: errorText(error) });
        return null;
    }
}

/**
 * The tokenId of the session making this request, or null.
 *
 * The claim lives in the JWT and nowhere else: `auth()` returns the session
 * object, which deliberately does not carry it, and the device list keeps it
 * out of its response for the same reason - an identifier that answers "which
 * session is this" is not something a browser needs handed back. So it is read
 * from the cookie on the server, where it already is.
 */
export async function callerSessionTokenId(request: Request): Promise<string | null> {
    const tokenId = (await callerToken(request))?.tokenId;
    return typeof tokenId === "string" && tokenId !== "" ? tokenId : null;
}
