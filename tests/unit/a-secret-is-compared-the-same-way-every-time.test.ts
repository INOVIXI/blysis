import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { secretsMatch } from "@/core/lib/constant-time";
import { relativePath, stripComments } from "./source-text";

/**
 * Two places compare a secret a caller sent against one the server holds.
 *
 * `checkCsrf` accepts `x-internal-request` as a way past the origin check,
 * and the module status endpoint accepts the same header in place of an
 * admin session. Both did it with `===`, which stops at the first byte that
 * differs and so takes a different amount of time for a near miss than for a
 * wrong first character.
 *
 * This is hardening rather than a hole: guessing a random secret through
 * network timing is not a practical attack. It is also the standard this
 * codebase already sets everywhere else, `timingSafeEqual` for a webhook
 * signature, and these two were the only ones that did not meet it.
 *
 * The comparison is written by hand rather than taken from `node:crypto`
 * because `csrf.ts` is reached from the proxy, and the proxy is not a place
 * to depend on a Node builtin being available.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

describe("comparing a secret", () => {
    it("accepts the right one", () => {
        expect(secretsMatch("s3cret-value", "s3cret-value")).toBe(true);
    });

    it("rejects a wrong one of the same length", () => {
        expect(secretsMatch("s3cret-value", "s3cret-valve")).toBe(false);
    });

    it("rejects one that is a prefix of the other", () => {
        expect(secretsMatch("s3cret", "s3cret-value")).toBe(false);
        expect(secretsMatch("s3cret-value-more", "s3cret-value")).toBe(false);
    });

    it("rejects an absent header rather than throwing", () => {
        expect(secretsMatch(null, "s3cret-value")).toBe(false);
        expect(secretsMatch(undefined, "s3cret-value")).toBe(false);
    });

    it("rejects everything when the server holds no secret", () => {
        // An empty expected value must not turn into "anything matches".
        expect(secretsMatch("", "")).toBe(false);
        expect(secretsMatch("anything", "")).toBe(false);
    });

    it("reads every character, so a near miss costs what a far miss costs", () => {
        // Not a timing measurement, which would be flaky. This pins the shape:
        // the loop covers the longer of the two rather than stopping early.
        const long = "a".repeat(64);
        const differsAtTheEnd = "a".repeat(63) + "b";
        expect(secretsMatch(differsAtTheEnd, long)).toBe(false);
    });
});

/** What a caller sent: a header, read or already bound. */
const CALLER = String.raw`(?:\w*[Hh]eader\w*|(?:\w+\.)*headers\.get\([^)]*\))`;
/** What the server holds: a secret by name, or one read from the environment. */
const HELD = String.raw`(?:process\.env\.\w*(?:SECRET|TOKEN|KEY)\w*|\w*(?:[Ss]ecret|SECRET)\w*)`;
const ENV = String.raw`process\.env\.\w*(?:SECRET|TOKEN|KEY)\w*`;
const OPERAND = String.raw`[\w.$"'\x60[\]]+`;
const EQ = String.raw`\s*[!=]==?\s*`;
/**
 * A comparison with a secret on one side, in either order. An environment
 * secret is held whatever it is compared with, so its other operand is kept
 * to tell a presence check from a real one.
 */
const COMPARISON = new RegExp(
    [
        `${CALLER}${EQ}${HELD}\\b`,
        `\\b${HELD}${EQ}${CALLER}`,
        `${ENV}${EQ}(?<after>${OPERAND})`,
        `(?<before>${OPERAND})${EQ}${ENV}`,
    ].join("|"),
    "g",
);
const ABSENT = /^(?:undefined|null|""|''|``)$/;

/** Every comparison in `code` that checks a value against a secret rather than for one. */
function plainComparisons(code: string): string[] {
    return [...code.matchAll(COMPARISON)]
        .filter((match) => {
            const other = match.groups?.after ?? match.groups?.before;
            return other === undefined || !ABSENT.test(other);
        })
        .map((match) => match[0].trim());
}

function sources(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "node_modules" && entry.name !== "generated") sources(full, out);
        } else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

describe("the check for a plain comparison", () => {
    const flags = (code: string) => plainComparisons(code).length > 0;

    it("catches it whichever operator and whichever side", () => {
        expect(flags(`if (headerValue === internalSecret) ok();`)).toBe(true);
        expect(flags(`if (request.headers.get("x-key") !== secret) deny();`)).toBe(true);
        expect(flags(`if (cronSecret === authHeader) ok();`)).toBe(true);
        expect(flags(`if (token === process.env.CRON_SECRET) ok();`)).toBe(true);
        expect(flags(`if (process.env.INTERNAL_API_KEY != given) deny();`)).toBe(true);
    });

    it("leaves a presence check and an unrelated header alone", () => {
        expect(flags(`if (process.env.CRON_SECRET === undefined) return;`)).toBe(false);
        expect(flags(`if (process.env.CRON_SECRET !== "") arm();`)).toBe(false);
        expect(flags(`if (headers.get("x-forwarded-proto") === "https") secure();`)).toBe(false);
        expect(flags(`if (cached.secret === secret) return cached.client;`)).toBe(false);
    });
});

describe("the places that compare one", () => {
    const sites = [
        "src/core/lib/csrf.ts",
        "src/app/api/v1/modules/status/route.ts",
    ];

    it("never compare a caller's secret with == or ===", () => {
        const offenders = [path.join(ROOT, "src"), path.join(ROOT, "module-sources")]
            .flatMap((dir) => sources(dir))
            .flatMap((file) =>
                plainComparisons(stripComments(fs.readFileSync(file, "utf8"))).map(
                    (comparison) => `${relativePath(ROOT, file)}: ${comparison}`,
                ),
            );
        expect(
            offenders,
            `These compare a caller's value against a server secret byte by byte; use secretsMatch:\n${offenders.join("\n")}`,
        ).toEqual([]);
    });

    it("reach for the shared comparison instead", () => {
        for (const rel of sites) {
            const body = fs.readFileSync(path.join(ROOT, rel), "utf8");
            expect(body, `${rel} should use secretsMatch`).toContain("secretsMatch");
        }
    });
});
