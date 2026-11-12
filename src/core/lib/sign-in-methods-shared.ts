/**
 * The rules for connecting a sign-in method to an account, with no imports.
 *
 * No imports for the reason `member-identity.ts` has none: the account page
 * and the general settings screen are client components and read the codes
 * and the setting key from here, while the sign-in callback and the API
 * routes read the same rules on the server. One spelling for both.
 *
 * Auth.js already links an OAuth account to whoever the session cookie names
 * when a signed-in browser comes back from a provider. That primitive is
 * right and the policy around it was missing: the cookie is only decoded, not
 * checked, so a revoked session, a session past its own deadline and an
 * admin acting as somebody else all name somebody, and each would have had a
 * provider account attached to it. `a-sign-in-method-joins-the-account-that-asked`
 * holds the rules below.
 */

/** Why a sign-in through a provider was turned away. Rides in a URL. */
export const CONNECT_REFUSAL = {
    /** The provider account is bound to a different member. Never moved. */
    taken: "taken",
    /** A signed-in browser came back, but this session asked for nothing. */
    notStarted: "not_started",
    /** The member already has an account from this provider. */
    alreadyConnected: "already_connected",
    /** An admin acting as a member; Auth.js would link to the admin. */
    impersonating: "impersonating",
    /** Nobody signed in, nothing bound, and the site takes no new accounts this way. */
    connectFirst: "connect_first",
} as const;

export type ConnectRefusal = (typeof CONNECT_REFUSAL)[keyof typeof CONNECT_REFUSAL];

/** The account page section, and the query it reads a result from. */
export const SIGN_IN_METHODS_SECTION = "sign-in-methods";
export const CONNECTED_PARAM = "connected";
export const CONNECT_ERROR_PARAM = "connectError";

const REFUSALS = new Set<string>(Object.values(CONNECT_REFUSAL));

export function isConnectRefusal(value: unknown): value is ConnectRefusal {
    return typeof value === "string" && REFUSALS.has(value);
}

/**
 * Where a refused provider sign-in sends the browser. A member who was
 * connecting reads why on the page they connected from; somebody who was
 * signing in is not on any page of ours yet, so they get the sign-in error
 * screen.
 */
export function connectRefusalPath(code: ConnectRefusal): string {
    if (code === CONNECT_REFUSAL.connectFirst) return "/auth/error?error=ConnectFirst";
    return `/profile?section=${SIGN_IN_METHODS_SECTION}&${CONNECT_ERROR_PARAM}=${code}`;
}

export interface OAuthSignInFacts {
    /** The member this provider account is already bound to, or null. */
    boundTo: string | null;
    /**
     * Who the browser's session cookie names, or null when it carries none
     * that decodes. `impersonating` because the cookie's subject is then the
     * admin, not the member on screen.
     */
    caller: { userId: string; impersonating: boolean } | null;
    /** Whether the caller already holds an account from this provider. */
    callerHasProvider: boolean;
    /** Whether this very session asked, minutes ago, to connect this provider. */
    connectStarted: boolean;
    /** The site setting: may a provider sign-in create an account. */
    newAccountsOpen: boolean;
}

/**
 * Null when the sign-in may go ahead, otherwise why not.
 *
 * Nothing here merges two accounts or moves a provider account from one
 * member to another: a provider account bound to somebody is that
 * somebody's, and the only way to change that is for them to disconnect it.
 */
export function oauthSignInRefusal(facts: OAuthSignInFacts): ConnectRefusal | null {
    const { boundTo, caller } = facts;

    if (!caller) {
        if (boundTo) return null;
        return facts.newAccountsOpen ? null : CONNECT_REFUSAL.connectFirst;
    }

    if (caller.impersonating) return CONNECT_REFUSAL.impersonating;
    if (boundTo) return boundTo === caller.userId ? null : CONNECT_REFUSAL.taken;
    if (!facts.connectStarted) return CONNECT_REFUSAL.notStarted;
    if (facts.callerHasProvider) return CONNECT_REFUSAL.alreadyConnected;
    return null;
}

/**
 * Null when the method may be removed. An account with no password and no
 * other provider would be one nobody can sign in to, and getting it back
 * would take an operator.
 */
export function disconnectRefusal(facts: { hasPassword: boolean; otherMethods: number }): "last_sign_in_method" | null {
    return facts.hasPassword || facts.otherMethods > 0 ? null : "last_sign_in_method";
}

/** Whether a provider sign-in may create a new account. */
export const SIGN_IN_METHOD_SIGN_UPS_KEY = "sign_in_method_sign_ups";

/**
 * Open unless closed. A provider sign-in has always made an account for
 * somebody new, and a switch that took that away on upgrade would lock out
 * every site that relies on it. Stored as JSON, so a boolean from a toggle
 * and a string from a choice must mean the same.
 */
export function signInMethodSignUps(stored: unknown): boolean {
    if (stored === false) return false;
    if (typeof stored === "string") return stored !== "false" && stored !== "0";
    return true;
}
