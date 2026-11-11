import { describe, it, expect } from "vitest";
import type { Adapter, AdapterAccount } from "@auth/core/adapters";
import {
    CONNECT_REFUSAL,
    disconnectRefusal,
    oauthSignInRefusal,
    signInMethodSignUps,
    type OAuthSignInFacts,
} from "@/core/lib/sign-in-methods-shared";
import { coreAuthAdapter, type CoreAdapterClient } from "@/core/lib/auth-adapter";

/**
 * A member connects a sign-in they hold elsewhere to the account they already
 * have here, and later signs in with it.
 *
 * Auth.js links an OAuth account to whoever the session cookie names, which
 * is the right primitive and the wrong policy on its own: a revoked cookie on
 * a shared machine, a cookie past its own deadline, an admin's cookie while
 * they act as somebody else, all name somebody, and every one of them would
 * have had a stranger's provider account attached to it. So a link happens
 * only when the session that asked for it, minutes ago, is the one coming
 * back, and everything else a signed-in browser brings home is refused with
 * a reason the member can read.
 */

const facts = (over: Partial<OAuthSignInFacts> = {}): OAuthSignInFacts => ({
    boundTo: null,
    caller: null,
    callerHasProvider: false,
    connectStarted: false,
    newAccountsOpen: true,
    ...over,
});

const member = { userId: "m1", impersonating: false };

describe("oauthSignInRefusal, nobody signed in", () => {
    it("signs in to the account the provider account is bound to", () => {
        expect(oauthSignInRefusal(facts({ boundTo: "m1" }))).toBeNull();
    });

    it("creates a new account when the site takes them", () => {
        expect(oauthSignInRefusal(facts())).toBeNull();
    });

    it("refuses a new account when the site only takes connected ones", () => {
        expect(oauthSignInRefusal(facts({ newAccountsOpen: false }))).toBe(CONNECT_REFUSAL.connectFirst);
    });

    it("still signs a connected member in when new accounts are closed", () => {
        expect(oauthSignInRefusal(facts({ boundTo: "m1", newAccountsOpen: false }))).toBeNull();
    });
});

describe("oauthSignInRefusal, a member signed in", () => {
    it("links when this session started a connect for this provider", () => {
        expect(oauthSignInRefusal(facts({ caller: member, connectStarted: true }))).toBeNull();
    });

    it("does not link what nobody asked to connect", () => {
        // A signed-in browser that wandered into a provider's sign-in, or a
        // stale cookie nobody remembers holding, is not a request to attach.
        expect(oauthSignInRefusal(facts({ caller: member }))).toBe(CONNECT_REFUSAL.notStarted);
    });

    it("refuses a provider account that is somebody else's, connect or not", () => {
        expect(oauthSignInRefusal(facts({ caller: member, boundTo: "m2", connectStarted: true })))
            .toBe(CONNECT_REFUSAL.taken);
        expect(oauthSignInRefusal(facts({ caller: member, boundTo: "m2" }))).toBe(CONNECT_REFUSAL.taken);
    });

    it("lets a member sign in again with what is already theirs", () => {
        expect(oauthSignInRefusal(facts({ caller: member, boundTo: "m1" }))).toBeNull();
    });

    it("keeps one account per provider per member", () => {
        expect(oauthSignInRefusal(facts({ caller: member, connectStarted: true, callerHasProvider: true })))
            .toBe(CONNECT_REFUSAL.alreadyConnected);
    });

    it("never links while an admin acts as somebody else", () => {
        // Auth.js links to the cookie's `sub`, which is still the admin's own
        // id during an impersonation: the member's screen would attach the
        // provider account to the admin.
        const acting = { userId: "m1", impersonating: true };
        expect(oauthSignInRefusal(facts({ caller: acting, connectStarted: true })))
            .toBe(CONNECT_REFUSAL.impersonating);
        expect(oauthSignInRefusal(facts({ caller: acting, boundTo: "m1" })))
            .toBe(CONNECT_REFUSAL.impersonating);
    });

    it("is not stopped by the site closing new accounts, because none is made", () => {
        expect(oauthSignInRefusal(facts({ caller: member, connectStarted: true, newAccountsOpen: false })))
            .toBeNull();
    });
});

describe("disconnectRefusal", () => {
    it("lets a member with a password drop their last provider", () => {
        expect(disconnectRefusal({ hasPassword: true, otherMethods: 0 })).toBeNull();
    });

    it("lets a member without a password drop one of two providers", () => {
        expect(disconnectRefusal({ hasPassword: false, otherMethods: 1 })).toBeNull();
    });

    it("refuses to leave an account nobody can sign in to", () => {
        expect(disconnectRefusal({ hasPassword: false, otherMethods: 0 })).toBe("last_sign_in_method");
    });
});

describe("signInMethodSignUps", () => {
    it("is open on a site that never chose", () => {
        expect(signInMethodSignUps(undefined)).toBe(true);
        expect(signInMethodSignUps(null)).toBe(true);
        expect(signInMethodSignUps("")).toBe(true);
    });

    it("closes from either control's spelling", () => {
        expect(signInMethodSignUps("false")).toBe(false);
        expect(signInMethodSignUps(false)).toBe(false);
        expect(signInMethodSignUps("true")).toBe(true);
    });
});

describe("a linked account remembers when it was connected", () => {
    it("writes the moment it was linked", async () => {
        const written: Record<string, unknown>[] = [];
        const prisma = {
            user: {},
            account: {
                create: async ({ data }: { data: Record<string, unknown> }) => {
                    written.push(data);
                    return data;
                },
            },
        } as unknown as CoreAdapterClient;
        const before = Date.now();
        await coreAuthAdapter({} as Adapter, prisma).linkAccount!({
            userId: "m1",
            type: "oauth",
            provider: "example",
            providerAccountId: "42",
        } as AdapterAccount);

        const at = written[0]?.connectedAt;
        expect(at).toBeInstanceOf(Date);
        expect((at as Date).getTime()).toBeGreaterThanOrEqual(before);
    });
});
