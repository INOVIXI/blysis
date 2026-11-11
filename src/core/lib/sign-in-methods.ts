/**
 * Sign-in methods a member has connected to their account, on the server.
 *
 * A sign-in method is a row in `Account`: an identity at a provider some
 * installed module brought, bound to one member. The rules about what may be
 * connected and removed live in `sign-in-methods-shared.ts`; this file reads
 * and writes the rows and answers the questions those rules need.
 *
 * Connecting is two requests from one browser. The account page asks for it
 * here first (`startConnect`), which writes down which session wanted which
 * provider, and only then sends the browser to the provider. When it comes
 * back, the sign-in callback spends that note (`oauthSignInGate`). Auth.js's
 * own state and PKCE checks already tie the callback to the browser that left;
 * the note ties it to the signed-in session that asked, so a link cannot be
 * made by anything the member did not start from their own account page.
 */
import crypto from "crypto";
import { prisma } from "./db";
import { configuredProviderIds } from "./auth-providers";
import { ModuleAuthDeclarations } from "@/core/generated/module-auth-declarations";
import { getModuleStates } from "./module-cache";
import { isEnabledIn } from "./module-enabled";
import { callerToken } from "./session-registry";
import { sessionExpired } from "./session-lifetime";
import {
    disconnectRefusal,
    oauthSignInRefusal,
    signInMethodSignUps,
    SIGN_IN_METHOD_SIGN_UPS_KEY,
    type ConnectRefusal,
} from "./sign-in-methods-shared";

/** Long enough to sign in at a provider, short enough that a forgotten tab is no standing invitation. */
const CONNECT_WINDOW_MS = 10 * 60_000;

/**
 * The note lives in `VerificationToken`, which already is the table for a
 * single-use, expiring proof and is swept by retention. Every other row there
 * is keyed by an e-mail address, which always holds an "@", so this prefix
 * cannot meet one of them.
 */
const NOTE_PREFIX = "sign-in-method:";

function noteKey(userId: string, tokenId: string, provider: string) {
    return {
        identifier: `${NOTE_PREFIX}${userId}`,
        token: crypto.createHash("sha256").update(`${tokenId}:${provider}`).digest("hex"),
    };
}

/**
 * The providers a member can connect on this install: the module is on, its
 * credentials are set, and it signs in through Auth.js's own callback. A
 * module that runs its own flow (an OpenID 2.0 redirect, say) never reaches
 * the callback that does the linking, so offering it would be a button that
 * makes a new account instead.
 */
export async function connectableProviders(): Promise<string[]> {
    let states: Record<string, boolean>;
    try {
        states = await getModuleStates();
    } catch {
        return [];
    }
    const declared = ModuleAuthDeclarations.filter(
        (entry) => isEnabledIn(states, entry.module) && (!entry.factory || entry.standardCallback === true),
    );
    return configuredProviderIds(declared, process.env);
}

/** Write down that this session asked to connect this provider. */
export async function startConnect(userId: string, tokenId: string, provider: string): Promise<void> {
    const key = noteKey(userId, tokenId, provider);
    await prisma.$transaction([
        prisma.verificationToken.deleteMany({ where: key }),
        prisma.verificationToken.create({ data: { ...key, expires: new Date(Date.now() + CONNECT_WINDOW_MS) } }),
    ]);
}

/** Spend the note. One statement, so two callbacks racing on it cannot both win. */
async function takeConnect(userId: string, tokenId: string, provider: string): Promise<boolean> {
    const { count } = await prisma.verificationToken.deleteMany({
        where: { ...noteKey(userId, tokenId, provider), expires: { gt: new Date() } },
    });
    return count === 1;
}

/** Whether the session a token names is still one the site honours. */
async function sessionLive(token: Record<string, unknown>, tokenId: string): Promise<boolean> {
    if (sessionExpired(token)) return false;
    const row = await prisma.userSession.findUnique({ where: { tokenId }, select: { isRevoked: true } });
    return row !== null && !row.isRevoked;
}

/**
 * Off is the closed position, so a settings read that fails answers closed:
 * an account that should not have been made is harder to undo than a sign-in
 * somebody retries.
 */
async function newAccountsOpen(): Promise<boolean> {
    try {
        const row = await prisma.setting.findUnique({ where: { key: SIGN_IN_METHOD_SIGN_UPS_KEY } });
        return signInMethodSignUps(row?.value ?? null);
    } catch {
        return false;
    }
}

export interface OAuthSignInVerdict {
    refusal: ConnectRefusal | null;
    /** The member this sign-in ends up as, or null for an account about to be made. */
    memberId: string | null;
}

/**
 * Decide a provider sign-in before Auth.js acts on it.
 *
 * Runs from the `signIn` callback, which Auth.js calls before
 * `handleLoginOrRegister` links, signs in or creates. It reads the session
 * cookie exactly as that function will, so the member it reasons about is the
 * member Auth.js would link to.
 */
export async function oauthSignInGate(input: {
    provider: string;
    providerAccountId: string;
    headers: Headers;
}): Promise<OAuthSignInVerdict> {
    const { provider, providerAccountId } = input;
    const bound = await prisma.account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        select: { userId: true },
    });

    const token = await callerToken({ headers: input.headers });
    const sub = typeof token?.sub === "string" && token.sub !== "" ? token.sub : null;
    const caller = token && sub
        ? { userId: sub, impersonating: typeof token.originalUserId === "string" && token.originalUserId !== "" }
        : null;

    let connectStarted = false;
    let callerHasProvider = false;
    if (token && caller && !caller.impersonating && !bound) {
        const tokenId = typeof token.tokenId === "string" ? token.tokenId : "";
        connectStarted = tokenId !== ""
            && (await sessionLive(token, tokenId))
            && (await takeConnect(caller.userId, tokenId, provider));
        if (connectStarted) {
            callerHasProvider = (await prisma.account.count({ where: { userId: caller.userId, provider } })) > 0;
        }
    }

    const refusal = oauthSignInRefusal({
        boundTo: bound?.userId ?? null,
        caller,
        callerHasProvider,
        connectStarted,
        newAccountsOpen: caller || bound ? true : await newAccountsOpen(),
    });

    return { refusal, memberId: bound?.userId ?? caller?.userId ?? null };
}

/**
 * The session this browser already holds, when a provider sign-in lands on
 * the member it belongs to.
 *
 * Auth.js mints a fresh token after every provider callback, which for a
 * connect meant a new device row, the old one left behind, and a session the
 * member asked to keep cut down to the short lifetime. Returning the token
 * they came in with keeps their session what it was.
 */
export async function sessionToKeep(userId: string, headers: Headers): Promise<Record<string, unknown> | null> {
    const token = await callerToken({ headers });
    if (!token || token.sub !== userId || token.id !== userId || typeof token.tokenId !== "string") return null;
    if (typeof token.originalUserId === "string" && token.originalUserId !== "") return null;
    // It replaces the token Auth.js just built, so it has to be a whole one.
    // A token minted before any of these existed is not kept; the member
    // gets a fresh session, which is what they would have had anyway.
    if (typeof token.role !== "string" || typeof token.absoluteExpiry !== "number") return null;
    // A stale cookie is not a session to keep: the member signing in with a
    // provider over it gets a new one, as anybody signing in does.
    return (await sessionLive(token, token.tokenId)) ? token : null;
}

export interface SignInMethodRow {
    provider: string;
    providerAccountId: string;
    displayName: string | null;
    connectedAt: Date | null;
}

/** A member's connected methods, without a single token column. */
export async function signInMethodsOf(userId: string): Promise<SignInMethodRow[]> {
    return prisma.account.findMany({
        where: { userId },
        orderBy: { provider: "asc" },
        select: { provider: true, providerAccountId: true, displayName: true, connectedAt: true },
    });
}

/** Whether a member can sign in with a password; the page needs it to explain a refused disconnect. */
export async function hasPassword(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
    return Boolean(user?.password);
}

export type DisconnectResult =
    | { ok: true; providerAccountId: string }
    | { ok: false; code: "not_found" | "last_sign_in_method" };

/**
 * Remove one of a member's methods, unless it is the last way in.
 *
 * The member's row is locked for the length of the check and the delete.
 * Without it, two disconnects of two different providers, sent together by a
 * member with no password, each see the other one still there and both go
 * through, and the account is left with no way in at all.
 */
export async function disconnectSignInMethod(userId: string, provider: string): Promise<DisconnectResult> {
    return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: userId }, select: { password: true } });
        if (!user) return { ok: false, code: "not_found" } as const;

        const accounts = await tx.account.findMany({
            where: { userId },
            select: { id: true, provider: true, providerAccountId: true },
        });
        const target = accounts.find((account) => account.provider === provider);
        if (!target) return { ok: false, code: "not_found" } as const;

        const refusal = disconnectRefusal({ hasPassword: Boolean(user.password), otherMethods: accounts.length - 1 });
        if (refusal) return { ok: false, code: refusal } as const;

        await tx.account.delete({ where: { id: target.id } });
        return { ok: true, providerAccountId: target.providerAccountId } as const;
    });
}
