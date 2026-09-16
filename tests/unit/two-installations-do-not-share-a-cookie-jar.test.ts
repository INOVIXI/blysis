import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Two installations on one host do not sign each other out.
 *
 * A cookie belongs to a domain and ignores the port, so a staging site beside
 * a live one - the ordinary shape of it - issues the same three names at the
 * same domain and overwrites the other's. Measured on this machine, both
 * servers answered `/api/auth/csrf` with `authjs.csrf-token` and
 * `authjs.callback-url`, and signing into one signed you out of the other.
 *
 * The word that separates them is empty by default, because changing the name
 * an installation issues signs out everybody holding the old one. An upgrade
 * must not do that; an operator who asks for it has chosen it.
 *
 * The second half is the trap that made this worth a test. `carriesSessionCookie`
 * matched a fixed list of historical names. Left alone, it would answer "no
 * session cookie" for every request on exactly the deployments that set the
 * word - and its callers treat a false as certain.
 */

const ENV = { ...process.env };

async function cookieNames(url: string, namespace: string) {
    process.env.AUTH_URL = url;
    process.env.NEXTAUTH_URL = url;
    process.env.AUTH_COOKIE_NAMESPACE = namespace;
    vi.resetModules();
    return import("@/core/lib/session-cookie");
}

describe("the cookies an installation issues", () => {
    beforeEach(() => { process.env = { ...ENV }; });
    afterEach(() => { process.env = { ...ENV }; });

    it("keeps the names it has always issued when nobody asks otherwise", async () => {
        const c = await cookieNames("http://localhost:3001", "");
        expect(c.SESSION_TOKEN_COOKIE).toBe("authjs.session-token");
        expect(c.CSRF_TOKEN_COOKIE).toBe("authjs.csrf-token");
        expect(c.CALLBACK_URL_COOKIE).toBe("authjs.callback-url");
    });

    it("puts the word in front of all three, not just the session", async () => {
        // The session token alone was configured; the other two were literals,
        // and they collide just as thoroughly.
        const c = await cookieNames("http://localhost:3001", "staging");
        expect(c.SESSION_TOKEN_COOKIE).toBe("staging.authjs.session-token");
        expect(c.CSRF_TOKEN_COOKIE).toBe("staging.authjs.csrf-token");
        expect(c.CALLBACK_URL_COOKIE).toBe("staging.authjs.callback-url");
    });

    it("leaves the browser prefix at the very start, where a browser reads it", async () => {
        const c = await cookieNames("https://site.example", "staging");
        expect(c.SESSION_TOKEN_COOKIE).toBe("__Secure-staging.authjs.session-token");
        expect(c.CSRF_TOKEN_COOKIE).toBe("__Host-staging.authjs.csrf-token");
    });

    it("still recognises its own session cookie once it has a word in it", async () => {
        const c = await cookieNames("http://localhost:3001", "staging");
        expect(c.carriesSessionCookie(`${c.SESSION_TOKEN_COOKIE}=abc; theme=dark`)).toBe(true);
        // And a request carrying none is still a request carrying none.
        expect(c.carriesSessionCookie("theme=dark")).toBe(false);
    });

    it("still recognises a session issued before the word existed", async () => {
        const c = await cookieNames("http://localhost:3001", "staging");
        expect(c.carriesSessionCookie("authjs.session-token=abc")).toBe(true);
        expect(c.carriesSessionCookie("next-auth.session-token=abc")).toBe(true);
    });

    it("takes nothing from the word that a cookie name may not hold", async () => {
        const c = await cookieNames("http://localhost:3001", "one two; drop=1");
        expect(c.SESSION_TOKEN_COOKIE).toBe("onetwodrop1.authjs.session-token");
    });
});
