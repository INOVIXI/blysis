import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { relativePath } from "./source-text";

/**
 * The site's own address is resolved in one place.
 *
 * `app-url.ts` exists because `NEXT_PUBLIC_*` is frozen into the bundle by
 * `next build` and Blysis ships a prebuilt image, so a canonical URL read
 * that way is whatever CI had, for every installation on earth. It also
 * rejects a value that is not an absolute http(s) URL.
 *
 * Three callers had written the lookup out by hand and got a different answer
 * each time. Two of them build the links in the verification and the
 * password-reset emails and fell back to `http://localhost:3000` - a port
 * nothing in this project listens on - and neither checked that the value it
 * read was a URL at all, so a host written without a scheme produced a link
 * no mail client can follow. The third built the share links under a blog
 * article and fell back to the empty string, handing Twitter and Facebook a
 * path with no host on any install that had not set AUTH_URL.
 *
 * The variables themselves stay readable in the few places that need the raw
 * value for something other than an address: session-cookie.ts decides the
 * cookie's `secure` flag and its name from the scheme, csrf.ts collects the
 * allowed origins, and app-url.ts is the resolver.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Files that may read the variables directly, and why. */
const RESOLVERS = new Set([
    "src/core/lib/app-url.ts",   // the resolver itself
    "src/core/lib/auth.ts",      // cookie `secure` flag, from the scheme
    "src/core/lib/csrf.ts",      // allowed origins, not an address to link to
    "src/core/lib/session-cookie.ts", // cookie `secure` flag and name, from the scheme
]);

const VARIABLES = /process\.env\.(AUTH_URL|NEXTAUTH_URL|NEXT_PUBLIC_APP_URL|NEXT_PUBLIC_SITE_URL)\b/g;

const SEARCH = ["src", "module-sources", "scripts"];

function sources(dir: string, into: string[] = []): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return into;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === "generated") continue;
            sources(full, into);
        } else if (/\.tsx?$/.test(entry.name)) {
            into.push(full);
        }
    }
    return into;
}

/** Class names and code only; a comment may name the variable it replaced. */
function code(source: string): string {
    return source
        .split("\n")
        .filter((line) => !/^\s*(?:\*|\/\/|\/\*)/.test(line))
        .join("\n");
}

describe("the site's address", () => {
    const files = SEARCH.flatMap((d) => sources(path.join(ROOT, d)));

    it("finds the sources", () => {
        expect(files.length).toBeGreaterThan(500);
    });

    it("is read through the resolver everywhere else", () => {
        const offenders: string[] = [];
        for (const file of files) {
            const relative = relativePath(ROOT, file);
            if (RESOLVERS.has(relative)) continue;
            const hits = code(fs.readFileSync(file, "utf8")).match(VARIABLES);
            if (hits) offenders.push(`${relative}: ${[...new Set(hits)].join(", ")}`);
        }
        expect(offenders).toEqual([]);
    });

    it("names only files that exist as resolvers", () => {
        for (const relative of RESOLVERS) {
            expect(fs.existsSync(path.join(ROOT, relative)), relative).toBe(true);
        }
    });

    it("is reachable by a module", () => {
        // A module cannot import `@/core/lib/*`, so the resolver has to be on
        // the SDK or the rule above is one a module cannot follow.
        const sdk = fs.readFileSync(path.join(ROOT, "src/core/sdk/server.ts"), "utf8");
        expect(sdk).toContain("resolveAppUrl");
    });
});
