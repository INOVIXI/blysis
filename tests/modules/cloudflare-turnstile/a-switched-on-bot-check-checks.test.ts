/**
 * A bot check that is switched on checks.
 *
 * This module once shipped an admin page with `enableOnLogin` and
 * `enableOnRegister`, saved both, and stopped there: no widget was rendered,
 * and `verifyTurnstileToken` had no callers. An administrator who turned bot
 * protection on got a page that said it was on and a site exactly as open as
 * before. Core now offers the `auth.form.challenge` slot and the
 * `auth.challenge` filter (held by tests/unit/auth-challenge.test.ts); these
 * tests hold the module to using both, to verifying the token it is given,
 * and to keeping the secret key out of anything the browser can read.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");

/** What core hands the first listener; a listener that passes returns it unchanged. */
const PASSED = { ok: true, code: null };

describe("the turnstile module", () => {
    const MODULE = "module-sources/cloudflare-turnstile";
    const manifest = JSON.parse(read(`${MODULE}/module.json`));

    it("contributes to the slot and listens to the filter", () => {
        expect(manifest.slotContents).toContainEqual(
            expect.objectContaining({ slot: "auth.form.challenge" }),
        );
        expect(manifest.hookListeners).toContainEqual(
            expect.objectContaining({ hook: "auth.challenge", type: "filter" }),
        );
    });

    it("declares the Cloudflare origins it loads from", () => {
        expect(manifest.csp?.["script-src"]).toContain("https://challenges.cloudflare.com");
        expect(manifest.csp?.["frame-src"]).toContain("https://challenges.cloudflare.com");
    });

    it("has a listener that actually calls the verifier", () => {
        const listener = read(`${MODULE}/hooks/on-auth-challenge.ts`);
        expect(listener).toContain("verifyTurnstileToken");
    });

    it("never puts the secret key in a public response", () => {
        const publicRoute = read(`${MODULE}/api/public-config/route.ts`);
        expect(publicRoute).not.toContain("secretKey");
        expect(publicRoute).not.toMatch(/\.\.\.\s*value|NextResponse\.json\(\s*setting/);
    });

    it("ships the strings for the codes it invents, rather than core doing it", () => {
        for (const locale of ["en", "tr"]) {
            const auth = manifest.translations[locale]?.auth ?? {};
            expect(auth, `${locale}`).toHaveProperty("err.captcha_failed");
            expect(auth, `${locale}`).toHaveProperty("err.captcha_missing");
            const core = JSON.parse(read(`messages-core/${locale}.json`));
            expect(core.auth, `core should not know what a captcha is (${locale})`).not.toHaveProperty(
                "err.captcha_failed",
            );
        }
    });

    it("keeps the admin settings route behind an admin check", () => {
        expect(read(`${MODULE}/api/settings/route.ts`)).toContain("isAdmin");
    });

    it("ships the widget it declares", () => {
        expect(existsSync(join(ROOT, MODULE, "slots/TurnstileChallenge.tsx"))).toBe(true);
    });
});

describe("the turnstile listener", () => {
    const load = async () => {
        vi.resetModules();
        return await import("@/modules/cloudflare-turnstile/hooks/on-auth-challenge");
    };
    const settings: { value: Record<string, unknown> | null } = { value: null };

    beforeEach(() => {
        settings.value = null;
        // The secret key is encrypted at rest, so the widget reads its config
        // through the SDK rather than off the row.
        vi.doMock("@/core/sdk/server", () => ({
            readSettingValues: async () => ({
                cloudflare_turnstile_config: settings.value ?? undefined,
            }),
        }));
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({ json: async () => ({ success: settings.value?.__valid !== false }) })),
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.doUnmock("@/core/sdk/server");
    });

    const context = (action: "login" | "register", fields: Record<string, string> = {}) => ({
        action,
        fields,
        ip: null,
    });

    it("passes when the module is installed but has no keys", async () => {
        const { default: listener } = await load();
        await expect(listener(PASSED, context("login"))).resolves.toEqual(PASSED);
    });

    it("passes when the keys are set but the form is switched off", async () => {
        settings.value = { siteKey: "s", secretKey: "k", enableOnLogin: false, enableOnRegister: true };
        const { default: listener } = await load();
        await expect(listener(PASSED, context("login"))).resolves.toEqual(PASSED);
    });

    it("refuses a missing token as firmly as a bad one", async () => {
        settings.value = { siteKey: "s", secretKey: "k", enableOnLogin: true };
        const { default: listener } = await load();
        await expect(listener(PASSED, context("login"))).resolves.toEqual({
            ok: false,
            code: "captcha_missing",
        });
    });

    it("passes a token Cloudflare accepts", async () => {
        settings.value = { siteKey: "s", secretKey: "k", enableOnRegister: true };
        const { default: listener } = await load();
        await expect(
            listener(PASSED, context("register", { "cf-turnstile-response": "good" })),
        ).resolves.toEqual(PASSED);
    });

    it("refuses a token Cloudflare rejects", async () => {
        settings.value = { siteKey: "s", secretKey: "k", enableOnRegister: true, __valid: false };
        const { default: listener } = await load();
        await expect(
            listener(PASSED, context("register", { "cf-turnstile-response": "bad" })),
        ).resolves.toEqual({ ok: false, code: "captcha_failed" });
    });

    it("does not overwrite a refusal another listener already made", async () => {
        settings.value = { siteKey: "s", secretKey: "k", enableOnLogin: true };
        const { default: listener } = await load();
        const earlier = { ok: false, code: "rate_limited" };
        await expect(listener(earlier, context("login"))).resolves.toEqual(earlier);
    });
});
