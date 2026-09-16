/**
 * An auth failure reaches the reader in the reader's language.
 *
 * Every endpoint under /api/v1/auth answered with an English sentence and
 * nothing else, and every screen rendered that sentence straight into the
 * page. A Turkish visitor whose username was taken, whose reset link had
 * expired, whose password turned up in a breach corpus, or who had simply
 * tried once too often, read the whole thing in English on an otherwise
 * Turkish page. There was no machine-readable signal to translate from.
 *
 * The English string stays on the wire for API clients and logs. Alongside
 * it now travels a stable `code`, the catalogue carries `auth.err.<code>` in
 * every locale, and `authErrorMessage` is what the screens call.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { stripComments } from "./source-text";

const ROOT = join(__dirname, "../..");
const AUTH_API = join(ROOT, "src/app/api/v1/auth");
const AUTH_PAGES = join(ROOT, "src/app/[locale]/(auth)");

function walk(dir: string, match: RegExp, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, match, out);
        else if (match.test(entry)) out.push(full);
    }
    return out;
}

function code(path: string): string {
    return stripComments(readFileSync(path, "utf8"));
}

function catalogue(locale: string): Record<string, string> {
    const json = JSON.parse(readFileSync(join(ROOT, `messages-core/${locale}.json`), "utf8"));
    return json.auth.err ?? {};
}

const LOCALES = readdirSync(join(ROOT, "messages-core"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));

/**
 * The endpoints, and the one library that decides a refusal for them.
 *
 * `email-change.ts` answers with a typed union of codes and the two routes
 * that call it pass whatever comes back. A scan that reads only literals
 * inside the route sees `code: outcome.code` and concludes the endpoint sends
 * nothing and its messages are orphans. The union is the stronger version of
 * the same promise - TypeScript refuses a code that is not in it - so the file
 * that declares it is read here too.
 */
const ROUTES = [
    ...walk(AUTH_API, /^route\.ts$/),
    join(ROOT, "src/core/lib/email-change.ts"),
];

/**
 * A code an endpoint can answer with. Two spellings reach a caller: the
 * literal, and the fallback behind a `??` where the code comes from a shared
 * refusal map and may be missing. `challenge_failed` is only ever the second
 * kind, so a scan that reads the first alone calls its message an orphan.
 */
const CODE_LITERAL = /\bcode:\s*(?:[^,}\n]*\?\?\s*)?"([a-z_]+)"/g;

/** A refusal declared as a union of literals, which is a code by another name. */
const CODE_UNION = /export type \w*Refusal\s*=\s*([^;]+);/g;

/**
 * A response body literal that names `error`. The capture is the whole
 * object so the assertion can look for a sibling `code` inside it.
 */
function errorBodies(src: string): string[] {
    const bodies: string[] = [];
    for (let i = src.indexOf("{ error:"); i !== -1; i = src.indexOf("{ error:", i + 1)) {
        // A log line names `error` too, and it is not a response. The
        // contract this pins is what a caller reads, so anything handed to
        // the logger is skipped.
        const lineStart = src.lastIndexOf("\n", i) + 1;
        if (/\blog\.(error|warn|info|debug)\(/.test(src.slice(lineStart, i))) continue;
        bodies.push(src.slice(i, src.indexOf("}", i) + 1));
    }
    // The multi-line form, where the message sits on its own line.
    for (const m of src.matchAll(/\{\s*\n\s*error:[\s\S]{0,300}?\n\s*\}/g)) bodies.push(m[0]);
    return bodies;
}

describe("auth API error contract", () => {
    it("covers every auth endpoint", () => {
        expect(ROUTES.length).toBeGreaterThanOrEqual(6);
    });

    it("every error response carries a code", () => {
        const uncoded: string[] = [];
        for (const route of ROUTES) {
            for (const body of errorBodies(code(route))) {
                // `code: challenge.code ?? "challenge_failed"` is the one
                // shape that is not a bare literal, and it has to be: the
                // module that refuses names its own code, and core supplies
                // the fallback when it does not. It still always yields a
                // string, which is what this gate is for.
                if (/\bcode:\s*\w+\.code \?\? "/.test(body)) continue;
                // `code: outcome.code`, where `outcome` is a refusal typed as
                // a union of literals. TypeScript refuses anything outside the
                // union, which is a stronger promise than a literal written
                // here - and the union's members are collected below, so the
                // messages for them are still held to the same rule.
                if (/\bcode:\s*outcome\.code\b/.test(body)) continue;
                if (!/\bcode:\s*"/.test(body)) {
                    uncoded.push(`${route.slice(ROOT.length + 1)} -> ${body.replace(/\s+/g, " ").slice(0, 80)}`);
                }
            }
        }
        expect(uncoded).toEqual([]);
    });

    it("every code used has a message in every locale", () => {
        const used = new Set<string>();
        for (const route of ROUTES) {
            const body = code(route);
            for (const m of body.matchAll(CODE_LITERAL)) used.add(m[1]);
            for (const m of body.matchAll(CODE_UNION)) {
                for (const literal of m[1].matchAll(/"([a-z_]+)"/g)) used.add(literal[1]);
            }
        }
        expect(used.size).toBeGreaterThan(10);
        for (const locale of LOCALES) {
            const cat = catalogue(locale);
            expect([...used].filter((c) => !cat[c]).sort(), `missing in ${locale}`).toEqual([]);
        }
    });

    it("no locale carries a message no endpoint can send", () => {
        const used = new Set<string>();
        for (const route of ROUTES) {
            const body = code(route);
            for (const m of body.matchAll(CODE_LITERAL)) used.add(m[1]);
            for (const m of body.matchAll(CODE_UNION)) {
                for (const literal of m[1].matchAll(/"([a-z_]+)"/g)) used.add(literal[1]);
            }
        }
        for (const locale of LOCALES) {
            const orphans = Object.keys(catalogue(locale)).filter((c) => !used.has(c));
            expect(orphans, `orphaned in ${locale}`).toEqual([]);
        }
    });

    it("the locales agree on the message set", () => {
        const [first, ...rest] = LOCALES.map((l) => Object.keys(catalogue(l)).sort());
        for (const other of rest) expect(other).toEqual(first);
    });
});

describe("auth screens", () => {
    const PAGES = walk(AUTH_PAGES, /\.tsx$/);

    it("never render the server's English straight into the page", () => {
        const offenders = PAGES.filter((f) => /\bdata\??\.error\b|\bbody\.error\b/.test(code(f)))
            .map((f) => f.slice(ROOT.length + 1));
        expect(offenders).toEqual([]);
    });

    it("go through the shared mapper", () => {
        const mappers = PAGES.filter((f) => /authErrorMessage\(/.test(code(f)));
        expect(mappers.length).toBeGreaterThanOrEqual(4);
    });

    it("the profile screens map their auth failures too", () => {
        // The page was one file and is three: it kept the account form, the
        // privacy panel and the section switcher in one place, and the two
        // screens that talk to the auth endpoints moved out with the calls.
        const screens = [
            "src/core/components/profile/AccountSettings.tsx",
            "src/core/components/profile/PrivacyPanel.tsx",
        ];
        for (const screen of screens) {
            const src = code(join(ROOT, screen));
            expect(src, screen).not.toMatch(/\b(data|body)\.error\s*\|\|/);
            expect(src, screen).toContain("authErrorMessage(authT,");
        }
    });

    it("the OAuth account-not-linked error has a real message now", () => {
        const page = code(join(ROOT, "src/app/[locale]/(auth)/auth/error/page.tsx"));
        expect(page).not.toContain("t.has(");
        for (const locale of LOCALES) {
            const json = JSON.parse(readFileSync(join(ROOT, `messages-core/${locale}.json`), "utf8"));
            expect(json.auth.errorOAuthAccountNotLinked, locale).toBeTruthy();
        }
    });
});

describe("the mapper", () => {
    it("prefers the caller's fallback over an unknown code", async () => {
        const { authErrorMessage } = await import("@/core/lib/auth-error-message");
        const t = Object.assign((k: string) => `translated:${k}`, {
            has: (k: string) => k === "err.rate_limited",
        });
        expect(authErrorMessage(t, { code: "rate_limited", error: "English" }, "fb")).toBe(
            "translated:err.rate_limited",
        );
        expect(authErrorMessage(t, { code: "who_knows", error: "English" }, "fb")).toBe("fb");
        expect(authErrorMessage(t, { error: "English" }, "fb")).toBe("fb");
        expect(authErrorMessage(t, {}, "fb")).toBe("fb");
    });
});
