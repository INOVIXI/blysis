/**
 * The bot check that was switched on and did nothing.
 *
 * The cloudflare-turnstile module shipped an admin page with `enableOnLogin`
 * and `enableOnRegister`, saved both to the settings table, and stopped
 * there. No widget was rendered anywhere in the app, and
 * `verifyTurnstileToken` had no callers at all - the function existed and
 * nothing in the tree reached it. An administrator who turned bot protection
 * on got a page that said it was on and a site exactly as open as before,
 * which is worse than no module: it is a security control that reports
 * success without doing anything.
 *
 * It could not have worked, either, because core had nowhere to put it. A
 * module cannot add a field to the login form or refuse a request that core
 * owns. So core grew both halves and still knows nothing about CAPTCHAs:
 *
 *   - `auth.form.challenge`, a slot inside the login, register and
 *     forgot-password forms, whose contributions get an `onField` callback
 *     and report whatever they need sent;
 *   - `auth.challenge`, a filter run before credentials are checked or an
 *     account is created, carrying those fields, the action, and the IP.
 *
 * The tests below hold core's half of the contract: with nothing installed
 * the three forms are unchanged, a listener can refuse, and a broken listener
 * cannot lock everyone out. The module's half, including that the secret key
 * never reaches the browser, is in
 * tests/modules/cloudflare-turnstile/a-switched-on-bot-check-checks.test.ts.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { runChallenge } from "@/core/lib/auth-challenge";
import {
    CHALLENGE_FIELD,
    CHALLENGE_PASSED,
    parseChallengeFields,
} from "@/core/lib/auth-challenge-shared";
import { addFilter, removeFilter } from "@/core/lib/hooks";

const ROOT = join(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");

const AUTH_FORMS = [
    "src/app/[locale]/(auth)/auth/login/page.tsx",
    "src/app/[locale]/(auth)/auth/register/page.tsx",
    "src/app/[locale]/(auth)/auth/forgot-password/page.tsx",
];

describe("parseChallengeFields", () => {
    it("reads an object", () => {
        expect(parseChallengeFields({ "cf-turnstile-response": "abc" })).toEqual({
            "cf-turnstile-response": "abc",
        });
    });

    it("reads the JSON string the login form sends", () => {
        expect(parseChallengeFields('{"a":"b"}')).toEqual({ a: "b" });
    });

    it("gives an empty object for anything else", () => {
        for (const input of [undefined, null, "", "not json", "[1,2]", 42, [], { a: 1 }]) {
            expect(parseChallengeFields(input), String(input)).toEqual({});
        }
    });

    it("drops a value too long to be a token", () => {
        expect(parseChallengeFields({ a: "x".repeat(4097) })).toEqual({});
        expect(parseChallengeFields({ a: "x".repeat(4096) })).toEqual({ a: "x".repeat(4096) });
    });
});

describe("runChallenge", () => {
    const listeners: (() => void)[] = [];

    afterEach(() => {
        for (const undo of listeners.splice(0)) undo();
    });

    const listen = (fn: Parameters<typeof addFilter<"auth.challenge">>[1]) => {
        addFilter("auth.challenge", fn);
        listeners.push(() => removeFilter("auth.challenge", fn));
    };

    it("passes when nothing is listening", async () => {
        await expect(
            runChallenge({ action: "login", fields: {}, ip: null }),
        ).resolves.toEqual(CHALLENGE_PASSED);
    });

    it("lets a listener refuse with its own code", async () => {
        listen(() => ({ ok: false, code: "captcha_failed" }));
        await expect(
            runChallenge({ action: "register", fields: {}, ip: "1.2.3.4" }),
        ).resolves.toEqual({ ok: false, code: "captcha_failed" });
    });

    it("gives the listener the action, the fields and the IP", async () => {
        const seen: unknown[] = [];
        listen((result, context) => {
            seen.push(context);
            return result;
        });
        await runChallenge({ action: "login", fields: { t: "x" }, ip: "9.9.9.9" });
        expect(seen).toEqual([{ action: "login", fields: { t: "x" }, ip: "9.9.9.9" }]);
    });

    it("does not lock everyone out when a listener throws", async () => {
        listen(() => {
            throw new Error("module is broken");
        });
        await expect(
            runChallenge({ action: "login", fields: {}, ip: null }),
        ).resolves.toEqual(CHALLENGE_PASSED);
    });

    it("keeps the first refusal when a second listener would pass", async () => {
        listen(() => ({ ok: false, code: "captcha_missing" }));
        listen((result) => result);
        await expect(
            runChallenge({ action: "login", fields: {}, ip: null }),
        ).resolves.toEqual({ ok: false, code: "captcha_missing" });
    });
});

describe("the three auth forms", () => {
    it("all render the slot", () => {
        for (const rel of AUTH_FORMS) {
            expect(read(rel), rel).toContain("<Challenge");
        }
    });

    it("all send whatever the slot reported", () => {
        for (const rel of AUTH_FORMS) {
            expect(read(rel), rel).toContain("CHALLENGE_FIELD");
            expect(read(rel), rel).toContain("challenge.read()");
        }
    });

    it("names the field once, in core", () => {
        expect(CHALLENGE_FIELD).toBe("challenge");
        const offenders: string[] = [];
        for (const rel of AUTH_FORMS) {
            if (/["']challenge["']\s*:/.test(read(rel))) offenders.push(rel);
        }
        expect(offenders, `Use CHALLENGE_FIELD:\n${offenders.join("\n")}`).toEqual([]);
    });
});

describe("the three server entry points", () => {
    const ENTRIES = [
        "src/core/lib/auth.ts",
        "src/app/api/v1/auth/register/route.ts",
        "src/app/api/v1/auth/forgot-password/route.ts",
    ];

    it("all await the challenge and keep its answer", () => {
        for (const rel of ENTRIES) {
            expect(read(rel), rel).toMatch(
                /const challenge = await runChallenge\(\{/,
            );
        }
    });

    it("all refuse rather than ignore a failed one", () => {
        for (const rel of ENTRIES) {
            expect(read(rel), rel).toMatch(/if \(!challenge\.ok\)|challenge\.ok\s*\)/);
        }
    });

    it("run it before the account is looked up or created", () => {
        const auth = read("src/core/lib/auth.ts");
        expect(auth.indexOf("runChallenge")).toBeLessThan(auth.indexOf("prisma.user.findUnique"));
    });
});

describe("the error strings", () => {
    it("keep core's own fallback in both locales core ships", () => {
        for (const locale of ["en", "tr"]) {
            const messages = JSON.parse(read(`messages-core/${locale}.json`));
            for (const key of ["challengeFailed", "err.challenge_failed"]) {
                expect(messages.auth, `${locale}: auth.${key}`).toHaveProperty(key);
            }
        }
    });
});
