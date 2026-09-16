import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * An answer that is the same for everybody says how long it may be kept.
 *
 * A public page asks for eleven things before it has drawn anything, and most
 * of those answers are identical for every visitor: the site's currency, the
 * announcements, the Discord server id, the SEO record for a path. Two
 * endpoints already said so with `s-maxage`; eight said nothing, so every
 * visitor's request travelled to the origin and ran the query again.
 *
 * One of the eight is gone rather than fixed: the SEO record for a path was
 * fetched by a client component that rewrote `document.head` after the page
 * had loaded, which no crawler ever ran. The override reaches the head on the
 * server now and nothing asks for it over HTTP.
 *
 * `s-maxage` speaks to shared caches and not to browsers, which is the point:
 * a proxy in front of the site may hold the answer for thirty seconds, and no
 * visitor's own cache is involved.
 *
 * That is also what makes the second half of this test a security rule rather
 * than a tidiness one. An answer that varies by who asked must never carry it:
 * the blog list and the slider both show an administrator what is not
 * published yet, and one shared cache entry would hand that to the next
 * anonymous reader. They are named here so it stays deliberate.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SHARED_CACHE = /Cache-Control["']?\s*:\s*[`"'][^`"']*s-maxage/;

/**
 * What a public page fetches on its first load, and which is the same answer
 * whoever is asking. Verified rather than assumed: none of these GET handlers
 * reads the session.
 */
const SAME_FOR_EVERYONE = [
    "src/app/api/v1/public-settings/route.ts",
    "module-sources/store/api/widget-stats/route.ts",
    "module-sources/discord-widget/api/route.ts",
    "module-sources/currency/api/route.ts",
    "module-sources/announcements/api/route.ts",
    "module-sources/store/api/community-goal/route.ts",
    "module-sources/store/api/products/route.ts",
];

function routeFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) routeFiles(full, out);
        else if (entry.name === "route.ts") out.push(full);
    }
    return out;
}

/** The body of the GET handler, up to the next verb this file exports. */
function getHandler(source: string): string | null {
    const start = source.search(/export\s+(?:async\s+)?(?:const|function)\s+GET\b/);
    if (start === -1) return null;
    const rest = source.slice(start);
    const next = rest.search(/\nexport\s+(?:async\s+)?(?:const|function)\s+(POST|PUT|PATCH|DELETE)\b/);
    return next === -1 ? rest : rest.slice(0, next);
}

describe("a public answer", () => {
    it("says how long a shared cache may keep it, when it is the same for everyone", () => {
        const silent = SAME_FOR_EVERYONE.filter((relative) => {
            const full = path.join(ROOT, relative);
            expect(fs.existsSync(full), `${relative} should exist`).toBe(true);
            return !SHARED_CACHE.test(fs.readFileSync(full, "utf8"));
        });
        expect(
            silent,
            `these answer the same thing to every visitor and let every visitor ask the origin:\n${silent.join("\n")}`,
        ).toEqual([]);
    });

    it("never says it when the answer depends on who asked", () => {
        const leaky: string[] = [];
        for (const base of ["src/app", "module-sources"]) {
            for (const file of routeFiles(path.join(ROOT, base))) {
                const source = fs.readFileSync(file, "utf8");
                if (!SHARED_CACHE.test(source)) continue;
                const handler = getHandler(source);
                if (!handler) continue;
                // Comments are prose about the code, and this file's own
                // comment explains that it reads no session - which is the
                // sentence that used to fail it.
                const code = stripComments(handler);
                if (/\bauth\s*\(\s*\)|\bisAdmin\b|\bsession\b/.test(code)) {
                    leaky.push(path.relative(ROOT, file));
                }
            }
        }
        expect(
            leaky,
            `these vary by who asked and offer the answer to a shared cache, which would hand one reader's view to the next:\n${leaky.join("\n")}`,
        ).toEqual([]);
    });
});
