import crypto from "crypto";
import { cache } from "react";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { impersonationRefusal } from "./impersonation";
import { identifierLookup } from "./login-identifier";
import { REFUSAL_CODE } from "./login-refusal";
import { loginAllowedFrom, noteFailedLoginFrom } from "./login-throttle";
import { CALLBACK_URL_COOKIE, CSRF_TOKEN_COOKIE, SECURE_SESSION_COOKIES, SESSION_TOKEN_COOKIE } from "./session-cookie";
import { SignInRefusal } from "./sign-in-refusal";
import {
    REMEMBERED_MAX_AGE_SECONDS,
    parseRemember,
    sessionExpired,
    sessionExpiresAt,
} from "./session-lifetime";
import { shouldRecheckSession } from "./session-recheck";
import { SESSION_RECHECK_INTERVAL_SECONDS } from "./session-recheck";
import { forgetChecked, markChecked, wasCheckedWithin } from "./session-check-memo";
import { recordSignIn, touchSession, SESSION_TOUCH_INTERVAL_MS } from "./session-registry";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { coreAuthAdapter } from "./auth-adapter";
import { prisma } from "./db";
import { hashPassword, needsRehash, verifyPassword } from "./password-hash";
import { memberStanding } from "./member-standing";
import { getHashAlgorithm } from "./security-settings";
import {
    getLockoutStatus,
    registerFailedLogin,
    resetFailedLogins,
} from "./account-lockout";
import { getClientIP } from "./rate-limit";
import { runChallenge } from "./auth-challenge";
import { parseChallengeFields, CHALLENGE_FIELD } from "./auth-challenge-shared";

import type { Provider } from "next-auth/providers";
import {
    ModuleAuthProviders,
    ModuleAuthProviderFactories,
    ModuleOwnAuthProviderFactories,
} from "@/core/generated/module-auth-providers";
import { resolveAuthProviders } from "./auth-providers";

// OAuth providers come from installed modules only - core names none. A module
// declares `authProviders` in its manifest, the registry generator collects the
// declarations, and the provider activates once its env vars are set.
const oauthProviders = resolveAuthProviders(ModuleAuthProviders, {
    factories: ModuleAuthProviderFactories,
    moduleFactories: ModuleOwnAuthProviderFactories,
}) as Provider[];

// Session cookie hardening.
//
// Auth.js v5 already sets httpOnly + sameSite=lax and prepends the
// `__Secure-` prefix automatically in production (secure=true cookies
// only). We spell the configuration out explicitly here so a future
// change can't accidentally demote any of these attributes without
// showing up in code review.
//
// SameSite=lax is the right balance for this app: it protects against
// CSRF on cross-site POSTs while still allowing OAuth redirects
// (which arrive as top-level GETs) to carry the session.
//
// We do NOT set `__Host-` - it bans the Domain attribute AND requires
// Path=/. Auth.js's defaults meet those requirements, but using the
// explicit __Host- prefix name inside the cookies config confuses the
// Auth.js cookie-reading path in dev (HTTP localhost) because the
// browser silently drops the cookie without TLS. Leaving the prefix
// selection to Auth.js (__Secure- in prod, unprefixed in dev) is the
// safe default.
// Cookie hardening (`__Secure-` / `__Host-` prefix + Secure flag) is only
// valid when the site is served over HTTPS. In production deployments
// that run over plain HTTP (e.g. behind a local reverse proxy, or in
// dev/staging on an IP), setting these prefixes makes the browser drop
// the cookie silently, which breaks CSRF verification and login.
// Gate on the actual URL scheme instead of NODE_ENV.
const IS_PROD_COOKIE = SECURE_SESSION_COOKIES;


export const { handlers, auth, signIn, signOut } = NextAuth({
    // Core's `User` predates the shape Auth.js documents (`username` and
    // `avatar`, no `name`/`image`), so the stock adapter is wrapped rather
    // than used directly. See auth-adapter.ts.
    adapter: coreAuthAdapter(PrismaAdapter(prisma), prisma),
    session: {
        strategy: "jwt",
        // The cookie is issued at the longest lifetime any session can have;
        // a session the user did not ask to keep is cut short by the
        // absolute deadline the jwt callback enforces. See session-lifetime.ts.
        maxAge: REMEMBERED_MAX_AGE_SECONDS,
        // Auth.js consults updateAge in the database-session branch only, so
        // under the jwt strategy it throttles nothing. Role, ban and
        // revocation freshness is the jwt callback's job; session-recheck.ts
        // holds the interval that is actually enforced.
        updateAge: 60 * 60,
    },
    pages: {
        signIn: "/auth/login",
        error: "/auth/error",
    },
    cookies: {
        sessionToken: {
            name: SESSION_TOKEN_COOKIE,
            options: {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                secure: IS_PROD_COOKIE,
            },
        },
        callbackUrl: {
            name: CALLBACK_URL_COOKIE,
            options: {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                secure: IS_PROD_COOKIE,
            },
        },
        csrfToken: {
            name: CSRF_TOKEN_COOKIE,
            options: {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                secure: IS_PROD_COOKIE,
            },
        },
    },
    providers: [
        Credentials({
            name: "credentials",
            credentials: {
                // Named `email` for the accounts and clients that predate
                // username sign-in; the value may be either. See
                // login-identifier.ts.
                email: { label: "Email or username", type: "text" },
                password: { label: "Password", type: "password" },
                twoFactorCode: { label: "2FA Code", type: "text" },
                remember: { label: "Keep me signed in", type: "checkbox" },
                // Whatever the auth.form.challenge slot asked to be sent,
                // JSON-encoded. Core never reads inside it.
                challenge: { label: "Challenge", type: "hidden" },
            },
            async authorize(credentials, request) {
                const lookup = identifierLookup(credentials?.email);
                if (!lookup || !credentials?.password) {
                    return null;
                }

                // Before anything is looked up or hashed. The account lockout
                // further down counts against one account, which is no defence
                // at all against one password tried against every account: each
                // one sees a single failure and no threshold is reached. This
                // counts wrong passwords per address instead, and only wrong
                // ones - a shared office address signing people in all day
                // spends nothing.
                const callerHeaders = (request as Request | undefined)?.headers;
                const callerIp = callerHeaders ? getClientIP(callerHeaders) : "";
                if (!(await loginAllowedFrom(callerIp))) {
                    throw new SignInRefusal(REFUSAL_CODE.tooManyAttempts);
                }

                // Whatever module owns the auth.form.challenge slot gets to
                // refuse before any account is looked up, so a failed
                // challenge costs an attacker one round trip and tells them
                // nothing about whether the address exists. With no module
                // installed the filter has no listeners and this passes.
                const challengeHeaders = (request as Request | undefined)?.headers;
                const challenge = await runChallenge({
                    action: "login",
                    fields: parseChallengeFields(credentials?.[CHALLENGE_FIELD]),
                    ip: challengeHeaders ? getClientIP(challengeHeaders) : null,
                });
                if (!challenge.ok) {
                    // The module names its own reason and the code rides in a
                    // URL, so it is reduced to the alphabet a code may use
                    // before it leaves here. A module is not trusted input.
                    const named = (challenge.code ?? "").toLowerCase().replace(/[^a-z_]/g, "");
                    throw new SignInRefusal(
                        named ? `${REFUSAL_CODE.challengeFailed}:${named}` : REFUSAL_CODE.challengeFailed,
                    );
                }

                const user = await prisma.user.findUnique({
                    where: lookup,
                    include: { role: true },
                });

                if (!user || !user.password) {
                    // An address that does not exist here is still a guess,
                    // and enumerating addresses is what the per-address
                    // ceiling is for. The account lockout has nothing to
                    // count against, so this is the only place it lands.
                    await noteFailedLoginFrom(callerIp);
                    return null;
                }

                /*
                 * `user.isBanned` was the whole of this, and it was one of
                 * three things on the site that thought it decided who may
                 * take part. A member could carry a permanent ban on the
                 * punishment record and still sign in here, because this read
                 * a column and that record was a list nothing enforced.
                 * `memberStanding` is the one question now; this is core
                 * asking it rather than answering half of it.
                 */
                const standing = await memberStanding(user.id);
                if (!standing.mayEnter) {
                    throw new SignInRefusal(REFUSAL_CODE.banned);
                }

                // Account-level lockout check - short-circuits before bcrypt
                // so a locked account can't be brute-forced and can't be
                // used to fingerprint valid emails via response-time delta.
                const lockStatus = getLockoutStatus(user);
                if (lockStatus.locked) {
                    throw new SignInRefusal(REFUSAL_CODE.accountLocked);
                }

                const isPasswordValid = await verifyPassword(
                    credentials.password as string,
                    user.password
                );

                // Resolved once at the top of this function, where the
                // per-address ceiling is checked, so TRUSTED_PROXY_IPS
                // handling lives in one place (getClientIP).
                const reqHeaders = callerHeaders;
                const ip = callerIp === "" ? undefined : callerIp;

                if (!isPasswordValid) {
                    await noteFailedLoginFrom(callerIp);
                    // Bump the failure counter; when it crosses the
                    // threshold the account is automatically locked for
                    // ACCOUNT_LOCKOUT_MS (default 15m) and the user gets
                    // an early-warning email with the attacker's IP.
                    await registerFailedLogin(user.id, { ip });
                    return null;
                }

                /**
                 * The only moment a stored hash can be moved to the algorithm
                 * an operator has since chosen: the password is in this
                 * process now and never again. It runs after the password
                 * check and before the two-factor one on purpose - the
                 * password is proven here, and a member who cannot produce
                 * their second factor has still proven it.
                 *
                 * Detached, and its failure is not the member's problem: a
                 * write that does not land leaves the old hash, which still
                 * verifies, and the next login tries again.
                 */
                if (needsRehash(user.password, await getHashAlgorithm())) {
                    void (async () => {
                        const moved = await hashPassword(
                            credentials.password as string,
                            await getHashAlgorithm(),
                        );
                        await prisma.user.update({ where: { id: user.id }, data: { password: moved } });
                    })().catch(() => { /* Old hash stands. Tried again next time. */ });
                }

                // Second factor, only if the fields exist on the user: they are added by
                // whichever module provides it.
                const userAny = user as Record<string, unknown>;
                if (userAny.twoFactorEnabled && userAny.twoFactorSecret) {
                    // Dynamic import to avoid hard dependency on two-factor module
                    const { verifyTokenWithReplayProtection, verifyBackupCode } = await import("./two-factor");
                    const twoFactorCode = credentials.twoFactorCode as string;

                    if (!twoFactorCode) {
                        throw new SignInRefusal(REFUSAL_CODE.twoFactorRequired);
                    }

                    // Try TOTP first, then backup code. Replay-protected so
                    // an intercepted code can't be reused inside the
                    // ~90-second validity window.
                    const isValidTotp = await verifyTokenWithReplayProtection(
                        user.id,
                        userAny.twoFactorSecret as string,
                        twoFactorCode,
                    );

                    if (!isValidTotp) {
                        // Try backup code. Malformed JSON in backupCodes must
                        // not short-circuit into "valid": treat as no backup
                        // codes and fall through to the 2FA failure path so
                        // the attempt is still counted.
                        let backupCodes: string[] = [];
                        if (userAny.backupCodes) {
                            try {
                                const parsed = JSON.parse(userAny.backupCodes as string);
                                if (Array.isArray(parsed)) backupCodes = parsed;
                            } catch { /* corrupt row - treat as no backup codes */ }
                        }
                        const { valid, remaining } = verifyBackupCode(twoFactorCode, backupCodes);

                        if (!valid) {
                            // 2FA is a second authentication factor, so a
                            // wrong code must count toward the lockout just
                            // like a wrong password. Without this an attacker
                            // with a valid password could brute-force the
                            // 6-digit TOTP (~10^6 combos) unconstrained.
                            await noteFailedLoginFrom(callerIp);
                            await registerFailedLogin(user.id, { ip });
                            throw new SignInRefusal(REFUSAL_CODE.invalidTwoFactor);
                        }

                        // Update remaining backup codes
                        await prisma.user.update({
                            where: { id: user.id },
                            data: { backupCodes: JSON.stringify(remaining) } as Record<string, unknown>,
                        });
                    }
                }

                // Clear any residual failed-login counter - this login
                // succeeded, so any lockout from earlier failures (including
                // stale rows from an old attempt) should be reset before the
                // session is minted.
                await resetFailedLogins(user.id);

                // Fire user.login hook - modules can react to successful credential auth.
                // Extract ip + userAgent from the incoming Request (best-effort).
                try {
                    const headers = (request as Request | undefined)?.headers;
                    // Through getClientIP, so the address recorded against a
                    // login is the one the proxy vouched for rather than the
                    // leftmost forwarded entry, which the caller writes.
                    const ip = headers ? getClientIP(headers) : "";
                    const userAgent = headers?.get("user-agent") || "";
                    const { doActionAsync } = await import("./hooks");
                    await doActionAsync("user.login", {
                        userId: user.id,
                        email: user.email,
                        ip,
                        userAgent,
                    }).catch(() => {});
                } catch { /* non-fatal */ }

                return {
                    id: user.id,
                    email: user.email,
                    name: user.username,
                    image: user.avatar,
                    role: user.role?.name || "member",
                    rolePriority: user.role?.priority ?? 0,
                    remember: parseRemember(credentials.remember),
                    // The jwt callback never sees the request, and it is the
                    // only place that knows the token id a device row is keyed
                    // by. So the two facts about the caller ride out on the
                    // user object, the way `remember` already does.
                    signInIp: ip ?? null,
                    signInUserAgent: reqHeaders?.get("user-agent") ?? null,
                };
            },
        }),
        ...oauthProviders,
    ],
    events: {
        async createUser({ user }) {
            // Assign default "member" role to OAuth users on first sign-up
            const defaultRole = await prisma.role.findFirst({
                where: { name: "member" },
            });
            if (defaultRole && user.id) {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { roleId: defaultRole.id },
                });
            }
            // Fire user.registered action for modules to react to
            const { doActionAsync, HookNames } = await import("./hooks");
            await doActionAsync(HookNames.USER_REGISTERED, {
                userId: user.id!,
                email: user.email || "",
                username: user.name || "",
            });
        },
        async signIn({ user }) {
            const { doActionAsync, HookNames } = await import("./hooks");
            await doActionAsync(HookNames.USER_LOGGED_IN, {
                userId: user.id!,
                email: user.email || "",
            });
        },
        async signOut() {
            const { doActionAsync, HookNames } = await import("./hooks");
            await doActionAsync(HookNames.USER_LOGGED_OUT, {});
        },
    },
    callbacks: {
        // Reject OAuth and credential sign-ins at the handshake if the user
        // is banned, so we never mint a session (even a short-lived one) for
        // a banned account. The jwt callback below revokes active sessions
        // on their next refresh as a second line of defense.
        async signIn({ user }) {
            if (!user?.id) return true;
            const existing = await prisma.user.findUnique({
                where: { id: user.id },
                select: { isDeleted: true },
            });
            if (existing?.isDeleted) return false;
            // The same question the credentials path asks. An OAuth handshake
            // that skipped it was a way around every restriction a module
            // holds: sign in with the game launcher instead of a password.
            return (await memberStanding(user.id)).mayEnter;
        },
        async jwt({ token, user, trigger, session: updatePayload }) {
            if (user) {
                token.id = user.id;
                token.role = (user as { role?: string }).role;
                token.rolePriority = (user as { rolePriority?: number }).rolePriority ?? 0;
                // Generate a stable per-login token id for session tracking
                token.tokenId = crypto.randomUUID();
                // Only the credentials provider offers the checkbox; an OAuth
                // sign-in takes the short lifetime, which is what every
                // session got before "keep me signed in" existed.
                token.absoluteExpiry = sessionExpiresAt(
                    (user as { remember?: boolean }).remember === true,
                );
                // authorize() just read this user out of the database, so the
                // first request after signing in has nothing to re-check.
                token.checkedAt = Date.now();

                // This branch runs once per sign-in, and it is the only moment
                // that holds both the new token id and the user it belongs to.
                // Without a row here the sessions screen has nothing to list
                // and `isRevoked` below can never be true. An OAuth sign-in
                // reaches this without an address or a user agent, which costs
                // the row two columns and none of its purpose.
                await recordSignIn({
                    tokenId: token.tokenId as string,
                    userId: user.id as string,
                    expiresAt: new Date(token.absoluteExpiry as number),
                    ipAddress: (user as { signInIp?: string | null }).signInIp ?? null,
                    userAgent: (user as { signInUserAgent?: string | null }).signInUserAgent ?? null,
                });
            }

            // Enforced on every request, not only on refresh: the cookie now
            // outlives the un-remembered session by design, so nothing else
            // would end it.
            if (sessionExpired(token)) {
                return null as unknown as typeof token;
            }

            // ─── Impersonation: start ───
            // Triggered by client calling update({ impersonate: userId }).
            // Only the CURRENT token (pre-swap) may be admin, and it cannot
            // stack another impersonation on top of an existing one.
            if (
                trigger === "update" &&
                updatePayload &&
                typeof updatePayload === "object" &&
                "impersonate" in updatePayload &&
                typeof (updatePayload as { impersonate?: unknown }).impersonate === "string"
            ) {
                const targetUserId = (updatePayload as { impersonate: string }).impersonate;
                const target = await prisma.user.findUnique({
                    where: { id: targetUserId },
                    include: { role: true },
                });
                // The same rule the start endpoint applies. This is where the
                // token is actually rewritten, so a client that skips that
                // endpoint and calls update() directly meets it here too.
                // `|| !target` narrows the type; the refusal already covers
                // a missing row, so the two cannot disagree about it.
                if (
                    impersonationRefusal(
                        {
                            id: token.id as string,
                            role: token.role as string | undefined,
                            originalUserId: token.originalUserId as string | undefined,
                        },
                        target,
                    ) ||
                    !target
                ) {
                    return token;
                }
                token.originalUserId = token.id;
                token.id = target.id;
                token.role = target.role?.name || "member";
                token.rolePriority = target.role?.priority ?? 0;
                // The token now speaks for somebody else, so the stamp from
                // the admin's own check does not vouch for it. The process
                // keeps its own copy of that stamp, and it has to go too or
                // the next request reads the admin's answer for somebody
                // else's account.
                token.checkedAt = undefined;
                if (typeof token.tokenId === "string") forgetChecked(token.tokenId);
                return token;
            }

            // ─── Impersonation: stop ───
            // Restores the original admin identity on the token.
            if (
                trigger === "update" &&
                updatePayload &&
                typeof updatePayload === "object" &&
                "stopImpersonating" in updatePayload &&
                (updatePayload as { stopImpersonating?: unknown }).stopImpersonating === true
            ) {
                const original = token.originalUserId as string | undefined;
                if (!original) return token;
                const admin = await prisma.user.findUnique({
                    where: { id: original },
                    include: { role: true },
                });
                if (!admin) return token;
                token.id = admin.id;
                token.role = admin.role?.name || "member";
                token.rolePriority = admin.role?.priority ?? 0;
                token.originalUserId = undefined;
                token.checkedAt = undefined;
                if (typeof token.tokenId === "string") forgetChecked(token.tokenId);
                return token;
            }

            // Refresh role, ban and revocation state from the database, at
            // most once per SESSION_RECHECK_INTERVAL_SECONDS. This used to
            // run only when the client called update(), so a ban, a deletion,
            // a demotion and a revoked device all waited for the next
            // sign-in. See session-recheck.ts.
            //
            // When impersonating, we check the impersonated user (token.id) -
            // if they become banned/deleted the impersonation session ends
            // immediately, not at the next manual update(). When not
            // impersonating, this also refreshes the admin's own role so a
            // demotion takes effect on the next request.
            // `token.checkedAt` is written onto the token and the token is
            // written back to the browser by Auth.js's own handlers only, and
            // this app reads the session by calling `auth()` from routes and
            // from the proxy. So the cookie kept the stamp it was minted with
            // and this block ran on every request past the first minute:
            // measured at three UserSession updates, three selects and six
            // User selects per request. The process remembers what the cookie
            // could not; see session-check-memo.ts.
            const tokenId = typeof token.tokenId === "string" ? token.tokenId : null;
            const alreadyCheckedHere =
                trigger !== "update" &&
                tokenId !== null &&
                wasCheckedWithin(tokenId, SESSION_RECHECK_INTERVAL_SECONDS * 1000);

            if (shouldRecheckSession(token, trigger) && !alreadyCheckedHere) {
                const dbUser = await prisma.user.findUnique({
                    where: { id: token.id as string },
                    select: {
                        isBanned: true,
                        isDeleted: true,
                        role: { select: { name: true, priority: true } },
                    },
                });
                // A token whose user row is gone is a token for nobody.
                if (!dbUser) {
                    return null as unknown as typeof token;
                }
                if (dbUser.isDeleted) {
                    return null as unknown as typeof token;
                }
                // The recheck is what ends a session somebody already holds,
                // so it asks the whole question rather than reading one
                // column: a ban recorded while the member was signed in has to
                // reach them without waiting for them to sign out.
                if (!(await memberStanding(token.id as string)).mayEnter) {
                    return null as unknown as typeof token;
                }
                if (token.tokenId) {
                    const sess = await prisma.userSession.findUnique({
                        where: { tokenId: token.tokenId as string },
                        select: { isRevoked: true },
                    });
                    if (sess?.isRevoked) {
                        return null as unknown as typeof token;
                    }
                }
                token.role = dbUser.role?.name || "member";
                token.rolePriority = dbUser.role?.priority ?? 0;
                token.checkedAt = Date.now();
                if (tokenId) markChecked(tokenId);

                // Bounded by its own interval rather than by the recheck
                // rate: "last active" is rendered as a date and a time, so a
                // write a minute per session bought nothing a reader could
                // see. The row's own condition catches the other workers.
                if (tokenId && !wasCheckedWithin(`activity:${tokenId}`, SESSION_TOUCH_INTERVAL_MS)) {
                    await touchSession(tokenId);
                    markChecked(`activity:${tokenId}`);
                }

                // Double-check the original admin identity during impersonation
                // - if the admin has been banned / demoted since starting the
                // impersonation, we must NOT let them keep acting as someone else.
                if (token.originalUserId) {
                    const realAdmin = await prisma.user.findUnique({
                        where: { id: token.originalUserId as string },
                        select: { isBanned: true, isDeleted: true, role: { select: { name: true } } },
                    });
                    if (!realAdmin || realAdmin.isBanned || realAdmin.isDeleted || realAdmin.role?.name !== "admin") {
                        return null as unknown as typeof token;
                    }
                }
            }
            return token;
        },
        async session({ session, token }) {
            if (token && session.user) {
                session.user.id = token.id as string;
                session.user.role = token.role as string;
                session.user.rolePriority = (token.rolePriority as number) ?? 0;
                session.user.originalUserId = (token.originalUserId as string | undefined) ?? undefined;
            }
            return session;
        },
    },
});

/**
 * The session, fetched once per request however many components ask.
 *
 * `auth()` goes to the database every time it is called: the session row, the
 * user's ban and role, and the role itself. A server-rendered page asks more
 * than once without meaning to, because the layout, the page and a component
 * inside it each need to know who is signed in. Rendering `/tr/admin` made
 * that round trip three times over, nine queries for one answer.
 *
 * React's `cache` deduplicates for the length of a single render, which is
 * exactly the window where the answer cannot change. `auth()` itself is left
 * alone: it is also the middleware and route-handler entry point, where there
 * is no render to scope a cache to.
 */
export const getSession = cache(async () => auth());


// Type extensions for NextAuth
declare module "next-auth" {
    interface Session {
        user: {
            id: string;
            email: string;
            name: string;
            image?: string;
            role: string;
            rolePriority: number;
            /**
             * When set, this session is an admin impersonating another user.
             * The value is the admin's real user id. `session.user.id` reflects
             * the impersonated target while this field is populated.
             */
            originalUserId?: string;
        };
    }

    interface User {
        role?: string;
        rolePriority?: number;
        /** Set by the credentials provider from the "keep me signed in" box. */
        remember?: boolean;
    }
}

declare module "@auth/core/jwt" {
    interface JWT {
        id?: string;
        role?: string;
        rolePriority?: number;
        tokenId?: string;
        /** Epoch ms after which this session stops working. See session-lifetime.ts. */
        absoluteExpiry?: number;
        /** Set while impersonating - holds the real admin's user id. */
        originalUserId?: string;
        /** Epoch ms of the last database check. See session-recheck.ts. */
        checkedAt?: number;
    }
}
