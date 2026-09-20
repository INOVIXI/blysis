// @vitest-environment node
/**
 * Turnstile is offered on every form that takes something written.
 *
 * It had two switches, `enableOnLogin` and `enableOnRegister`, written into
 * its own config and read by its own listener. Core's challenge could only
 * name three forms anyway, so that was the whole of it: the one form a
 * stranger can write through without an account - a custom form's submission
 * - had a rate limit and nothing else in front of it.
 *
 * A form now declares itself as a challenge point, this module is switched on
 * per point, and the listener answers for whichever point it was asked about.
 *
 * The two old switches are read rather than migrated: every install that has
 * Turnstile on its login form has them, and nothing has to run for that to
 * keep being true.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let config: Record<string, unknown> | null = null;
let tokenIsGood = true;
const verified: string[] = [];

vi.mock("@/core/sdk/server", () => ({
    readSettingValues: async () => ({ cloudflare_turnstile_config: config }),
}));

vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    verified.push(init.body);
    return new Response(JSON.stringify({ success: tokenIsGood }), { status: 200 });
});

const onChallenge = (await import("../../../module-sources/cloudflare-turnstile/hooks/on-auth-challenge")).default;

const PASSED = { ok: true, code: null };
const ask = (action: string, token?: string) =>
    onChallenge(PASSED as never, {
        action,
        fields: token ? { "cf-turnstile-response": token } : {},
        ip: null,
    } as never);

const configured = { siteKey: "site", secretKey: "secret" };

beforeEach(() => {
    verified.length = 0;
    tokenIsGood = true;
    config = { ...configured, points: [] };
});

describe("a module that is not configured", () => {
    it("lets everything through, so installing it changes nothing", async () => {
        config = null;
        expect(await ask("login")).toEqual(PASSED);
        config = { siteKey: "site" };
        expect(await ask("login")).toEqual(PASSED);
        expect(verified).toEqual([]);
    });
});

describe("a point the operator switched on", () => {
    it("is asked for a token", async () => {
        config = { ...configured, points: ["forms.submit"] };
        expect(await ask("forms.submit")).toEqual({ ok: false, code: "captcha_missing" });
    });

    it("is refused when the token does not check out", async () => {
        config = { ...configured, points: ["forms.submit"] };
        tokenIsGood = false;
        expect(await ask("forms.submit", "t")).toEqual({ ok: false, code: "captcha_failed" });
    });

    it("is let through when it does", async () => {
        config = { ...configured, points: ["forms.submit"] };
        expect(await ask("forms.submit", "t")).toEqual(PASSED);
        expect(verified).toHaveLength(1);
    });
});

describe("a point the operator left off", () => {
    it("is not asked for anything, and nothing is verified", async () => {
        config = { ...configured, points: ["forms.submit"] };
        expect(await ask("forum.topic")).toEqual(PASSED);
        expect(verified).toEqual([]);
    });
});

describe("the two switches from before this existed", () => {
    it("still turn the login form on", async () => {
        config = { ...configured, enableOnLogin: true };
        expect(await ask("login")).toEqual({ ok: false, code: "captcha_missing" });
    });

    it("still turn the register form on", async () => {
        config = { ...configured, enableOnRegister: true };
        expect(await ask("register")).toEqual({ ok: false, code: "captcha_missing" });
    });

    it("leave a form they never named alone", async () => {
        config = { ...configured, enableOnLogin: true, enableOnRegister: true };
        expect(await ask("forms.submit")).toEqual(PASSED);
    });
});

describe("somebody else's refusal", () => {
    it("is not overwritten", async () => {
        config = { ...configured, points: ["login"] };
        const refused = { ok: false, code: "banned" };
        expect(await onChallenge(refused as never, { action: "login", fields: {}, ip: null } as never)).toEqual(refused);
        expect(verified).toEqual([]);
    });
});
