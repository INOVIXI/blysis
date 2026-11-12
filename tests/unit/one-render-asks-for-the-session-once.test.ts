/**
 * A page that asks who is signed in, three times, for one answer.
 *
 * `auth()` is a database round trip: the session row, the user's ban and
 * role, and the role itself. Nothing about a server render makes that
 * obvious, so a layout, the page inside it and a component inside that each
 * called it without knowing about the others. Rendering `/tr/admin` issued
 * thirty-one queries, nine of them the same three repeated three times.
 *
 * `getSession` is `auth()` wrapped in React's `cache`, which deduplicates for
 * the length of one render, which is exactly the window in which the answer
 * cannot change. The same page issues twenty-three queries now.
 *
 * `auth()` itself is deliberately untouched: it is also the entry point for
 * middleware and route handlers, where there is no render to scope a cache
 * to. That is why this gate is scoped to the trees that render.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "../..");

function filesUnder(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) filesUnder(full, out);
        else if (/\.tsx$/.test(entry.name)) out.push(full);
    }
    return out;
}

const rel = (f: string) => path.relative(ROOT, f);
const read = (f: string) => fs.readFileSync(f, "utf8");

describe("the session helper", () => {
    it("is the cached one, not a second copy of the raw call", () => {
        const src = read(path.join(ROOT, "src/core/lib/auth.ts"));
        expect(src).toMatch(/export const getSession = cache\(/);
        expect(src, "cache must come from react, not from a hand-rolled map")
            .toMatch(/import \{ cache \} from "react"/);
    });
});

describe("a rendered page", () => {
    /** Server components: the layouts, pages and components a render walks. */
    const rendered = [
        ...filesUnder(path.join(ROOT, "src/app")),
        ...filesUnder(path.join(ROOT, "src/core/components")),
    ].filter((f) => {
        const src = read(f);
        // Client components never call auth() at all, and route handlers are
        // not .tsx, so what is left is the server render tree.
        return !/^\s*["']use client["']/m.test(src);
    });

    it("finds the server-rendered files to check", () => {
        // Was 50, when thirty-four of them were `loading.tsx` files drawing a
        // placeholder page. Those are gone; what is left is the pages
        // themselves, and they are what this is about.
        expect(rendered.length).toBeGreaterThan(35);
    });

    it("asks through the cached helper, so one render is one round trip", () => {
        const raw = rendered
            .filter((f) => /await auth\(\)/.test(read(f)))
            .map(rel);

        expect(
            raw,
            `These render server-side and call auth() directly; use getSession() so a\n` +
            `layout, its page and a component inside it share one lookup:\n${raw.join("\n")}`,
        ).toEqual([]);
    });
});

/**
 * The same shape, one layer down.
 *
 * `getActiveTheme` is three queries: the active theme row, its customization
 * and its settings. Its own comment called it "cacheable upstream", and no
 * caller cached it, so an admin page asked again inside the layout that had
 * already asked. Six queries for one theme.
 */
describe("the active theme", () => {
    it("is resolved once per render", () => {
        const src = read(path.join(ROOT, "src/core/lib/theme-state.ts"));
        expect(src, "getActiveTheme must be wrapped in React cache")
            .toMatch(/export const getActiveTheme = cache\(/);
        expect(src).toMatch(/import \{ cache \} from "react"/);
    });

    it("is not re-exported uncached somewhere else", () => {
        // A second uncached path to the same three queries would put the
        // duplicate back without touching this file.
        const libDir = path.join(ROOT, "src/core/lib");
        const others = fs
            .readdirSync(libDir)
            .filter((n) => n.endsWith(".ts") && n !== "theme-state.ts")
            .map((n) => path.join(libDir, n));
        const leaks = others.filter((f) => /prisma\.themeState\.find/.test(read(f))).map(rel);
        expect(leaks, `These read the theme state directly:\n${leaks.join("\n")}`).toEqual([]);
    });
});

/**
 * The same answer, handed across the server/client line.
 *
 * `SessionProvider` fetches `/api/auth/session` on mount when it is not given
 * a session, which is a network round trip for something the server resolved
 * while rendering the page that contains it. Passing it costs nothing: the
 * lookup is already cached per render.
 */
describe("the client session provider", () => {
    it("is handed the session the server already resolved", () => {
        const layout = read(path.join(ROOT, "src/app/[locale]/layout.tsx"));
        expect(layout, "SessionProvider must receive a session prop")
            .toMatch(/<SessionProvider session=\{/);
        expect(layout, "and it must come from the cached helper")
            .toMatch(/getSession\(\)/);
    });
});

/**
 * The same shape, one layer further out.
 *
 * `buildPageMeta` reads `site_name` and `site_description` from Settings, and
 * every route that declares metadata calls it: the root layout does, and so
 * does the page rendered inside it. Neither knows about the other.
 *
 * Measured against a production build with statement logging on, `/en/blog`
 * issued twelve queries for one request and two of them were the identical
 * two-key Settings lookup. A layout's metadata and its page's metadata belong
 * to one request, which is exactly the window in which a site's own name
 * cannot change, and exactly the window `cache` covers.
 */
describe("the site's name and description", () => {
    it("are read once per render", () => {
        const src = read(path.join(ROOT, "src/core/lib/seo.ts"));
        expect(src, "getSeoSiteInfo must be wrapped in React cache")
            .toMatch(/const getSeoSiteInfo = cache\(/);
        expect(src).toMatch(/import \{ cache \} from "react"/);
    });

    it("are not reachable through a second uncached path", () => {
        // A second reader of the same keys would put the duplicate back
        // without this file changing.
        // `public-settings.ts` names the key in the allowlist every visitor
        // may read, and reads it through the shared `cached` store with the
        // TTL the operator sets, not straight from Settings on each render.
        // The allowlist sat in the route before the root layout needed it.
        const libDir = path.join(ROOT, "src/core/lib");
        const ALLOWED = new Set(["seo.ts", "public-settings.ts"]);
        const others = fs
            .readdirSync(libDir)
            .filter((n) => n.endsWith(".ts") && !ALLOWED.has(n))
            .map((n) => path.join(libDir, n));
        // A file that names the key without reaching the database is not a
        // reader: `site-contact.ts` lists it for the settings screen, which is
        // a client component and could not import a reader if it wanted to.
        const leaks = others.filter((f) => /"site_name"/.test(read(f)) && /prisma/.test(read(f))).map(rel);
        expect(others.some((f) => /"site_name"/.test(read(f))), "the scan should see the key named somewhere").toBe(true);
        expect(leaks, `These read the site name straight from Settings:\n${leaks.join("\n")}`).toEqual([]);
    });
});
