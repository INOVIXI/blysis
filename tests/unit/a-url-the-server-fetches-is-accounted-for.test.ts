import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * Every URL core fetches server-side is one somebody decided about.
 *
 * A `fetch` whose target is a literal is its own argument. A `fetch` whose
 * target is a variable is a question: where did that string come from, and can
 * anyone but the operator change it? `sendHealthWebhook` is the case that
 * proves the question is worth asking - it fetches a URL an admin types into
 * the alerting screen, and while the URL itself was checked against a private
 * host list, fetch was still free to follow a redirect to one. The check saw
 * hop one; the request went to hop two.
 *
 * So each of these is listed with where its URL comes from. Adding a fetch to
 * core means adding a line here, which means answering the question.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

/** `file:line` -> where that URL comes from, and why it is safe as written. */
const ACCOUNTED_FOR: Record<string, string> = {
    "src/core/lib/health-alerting.ts": "admin-typed webhook URL; validated, and refuses redirects",
    "src/core/lib/shared-request.ts": "caller-supplied; every caller passes an env-configured marketplace URL",
    "src/core/lib/password-breach.ts": "a constant vendor base plus a hex prefix of a hash",
};

/**
 * Comments, gone. The first draft of this guard flagged `read-json.ts`, whose
 * only `fetch(` is the prose explaining why `.then(r => r.json())` is wrong.
 * A guard that cries about a comment is one people learn to skip.
 */

/** Server-side files under src/core that call fetch with a non-literal URL. */
function unexplainedFetches(): string[] {
    const found = new Set<string>();
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "generated") continue;
                walk(full);
            } else if (entry.name.endsWith(".ts")) {
                // .tsx is a browser bundle: its fetch runs on the visitor's
                // machine and reaches nothing the visitor could not reach.
                const source = stripComments(fs.readFileSync(full, "utf8"));
                for (const m of source.matchAll(/(?<![.\w])fetch\(\s*([^,)]+)/g)) {
                    const arg = m[1].trim();
                    const literal = /^["'`]/.test(arg) && !/\$\{/.test(arg);
                    if (!literal) found.add(path.relative(ROOT, full));
                }
            }
        }
    };
    walk(path.join(ROOT, "src/core"));
    return [...found].sort();
}

describe("a URL core fetches server-side", () => {
    it("is one somebody wrote down the source of", () => {
        const unlisted = unexplainedFetches().filter((f) => !(f in ACCOUNTED_FOR));
        expect(
            unlisted,
            "add each to ACCOUNTED_FOR saying where its URL comes from, and decide about redirects",
        ).toEqual([]);
    });

    it("still lists only the files that actually fetch, so the list cannot rot", () => {
        const actual = unexplainedFetches();
        const stale = Object.keys(ACCOUNTED_FOR).filter((f) => !actual.includes(f));
        expect(stale, "these no longer fetch a non-literal URL; drop them").toEqual([]);
    });
});
