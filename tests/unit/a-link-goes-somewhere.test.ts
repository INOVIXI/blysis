import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { userProfilePath, userProfileRoutePattern } from "@/core/lib/user-profile-link";
import { stripComments } from "./source-text";

/**
 * A link in this product points at a page this product serves.
 *
 * Nothing checked, and the App Router hides the mistake: `/[locale]/[...slug]`
 * catches everything, looks for a module page or a custom page, finds neither
 * and answers 404. So a wrong href does not fail a build, does not fail a
 * type-check and does not look wrong in review. It just does not work.
 *
 * Four were dead:
 *
 *   - `/blog/category/<slug>` and `/blog/tag/<slug>`, linked from the blog's
 *     sidebar (every category), from each article's category line and from
 *     every tag chip. The `[...params]` catch-all reads the segment after
 *     `blog` as an article lookup, so these looked up an article called
 *     "category" and answered 404. The whole of the blog's browsing was dead.
 *   - `/login`, twice in the forum, where the route is `/auth/login`.
 *   - `/admin/page-builder/<id>` in the custom-pages admin, where the module
 *     declares `/custom-pages/builder/[id]`.
 *   - `/profile/<username>`, in core's own activity feed and audit log.
 *     `/profile` is the signed-in visitor's own page and takes no segment.
 *     Core cannot hardcode the module path that does serve profiles either,
 *     so the module declares `userProfile: true` on the route and core asks
 *     the registry; with no such module a username renders as text.
 */

const ROOT = process.cwd();
const LOCALE_DIR = "src/app/[locale]";

/** Every URL the App Router serves from core, groups dropped. */
function coreRoutes(): string[] {
    const out: string[] = [];
    const base = path.join(ROOT, LOCALE_DIR);
    const walk = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        if (entries.some((e) => e.isFile() && e.name === "page.tsx")) {
            const rel = path.relative(base, dir);
            const segs = rel === "" ? [] : rel.split(path.sep).filter((s) => !(s.startsWith("(") && s.endsWith(")")));
            out.push(segs.length ? `/${segs.join("/")}` : "/");
        }
        for (const entry of entries) {
            if (entry.isDirectory()) walk(path.join(dir, entry.name));
        }
    };
    walk(base);
    return out;
}

/** Every URL a module declares, public and admin. */
function moduleRoutes(): string[] {
    const out: string[] = [];
    const dir = path.join(ROOT, "module-sources");
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(dir, entry.name, "module.json");
        if (!fs.existsSync(manifestPath)) continue;
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
            routes?: { path: string }[];
            adminRoutes?: { path: string }[];
        };
        for (const r of manifest.routes ?? []) out.push(r.path);
        for (const r of manifest.adminRoutes ?? []) out.push(`/admin${r.path}`);
    }
    return out;
}

const ALL_ROUTES = [...new Set([...coreRoutes(), ...moduleRoutes()])].sort();
/** Routes that name themselves, rather than a catch-all that eats anything. */
const NAMED_ROUTES = ALL_ROUTES.filter((r) => !r.includes("[..."));

function matches(href: string, route: string): boolean {
    const a = href.split("/").filter(Boolean);
    const b = route.split("/").filter(Boolean);
    for (let i = 0; i < b.length; i++) {
        if (b[i].startsWith("[...")) return a.length >= i;
        if (i >= a.length) return false;
        if (b[i].startsWith("[")) continue;
        if (b[i] !== a[i]) return false;
    }
    return a.length === b.length;
}

/**
 * Hrefs that a catch-all serves at runtime, so a named route cannot vouch for
 * them. Each is a slug looked up in the database by the page the catch-all
 * resolves to, and each is recorded here so a new one is a decision.
 */
const SERVED_BY_A_CATCH_ALL = new Set([
    "/blog/X/X",        // /blog/[...params] - article number and slug
    "/blog/X",          // the same page, by slug alone
    "/forum/topic/X/X", // /forum/topic/[...params]
    "/store/product/X/X",
]);

interface Href {
    file: string;
    line: number;
    raw: string;
    href: string;
}

function hrefsIn(file: string, source: string): Href[] {
    const found: Href[] = [];
    for (const match of source.matchAll(/href=(?:"(\/[^"]*)"|\{`(\/[^`]*)`\})/g)) {
        const raw = match[1] ?? match[2];
        const href = (raw
            // `/${locale}` is how a page outside the locale-aware Link, such
            // as not-found.tsx, writes the site root.
            .replace(/^\/\$\{locale\}/, "")
            .replace(/\$\{[^}]*\}/g, "X")
            .split("?")[0]
            .split("#")[0]
            .replace(/\/+$/, "") || "/");
        if (href.startsWith("//") || href.startsWith("/api/") || href.startsWith("/uploads/")) continue;
        found.push({
            file: path.relative(ROOT, file),
            line: source.slice(0, match.index ?? 0).split("\n").length,
            raw,
            href,
        });
    }
    return found;
}

function walkTsx(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "generated") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkTsx(full, out);
        else if (entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
}

function allHrefs(): Href[] {
    return ["src/app", "src/core", "module-sources"]
        .flatMap((d) => walkTsx(path.join(ROOT, d)))
        .flatMap((f) => hrefsIn(f, fs.readFileSync(f, "utf8")));
}

describe("the route table", () => {
    it("is built from both halves of the product", () => {
        expect(coreRoutes()).toContain("/auth/login");
        expect(coreRoutes()).toContain("/profile");
        expect(moduleRoutes()).toContain("/blog");
        expect(moduleRoutes()).toContain("/admin/custom-pages/builder/[id]");
        expect(ALL_ROUTES.length).toBeGreaterThan(100);
    });

    it("has no route serving /profile/<username>, which is why core stopped linking there", () => {
        expect(NAMED_ROUTES.some((r) => matches("/profile/somebody", r))).toBe(false);
    });
});

describe("an internal link", () => {
    const hrefs = allHrefs();

    it("is found by the scan at all", () => {
        expect(hrefs.length).toBeGreaterThan(100);
    });

    it("names a route this product serves", () => {
        const dead = hrefs
            .filter((h) => !NAMED_ROUTES.some((r) => matches(h.href, r)))
            .filter((h) => !SERVED_BY_A_CATCH_ALL.has(h.href))
            .map((h) => `${h.file}:${h.line}  ${h.raw}`);
        expect([...new Set(dead)]).toEqual([]);
    });
});

describe("the blog's browsing", () => {
    /** Comments stripped: the doc comments here name the routes that died. */
    const read = (file: string) =>
        stripComments(fs.readFileSync(path.join(ROOT, file), "utf8"));
    const index = read("module-sources/blog/pages/page.tsx");
    const article = read("module-sources/blog/pages/[...params]/page.tsx");

    it("filters the index instead of linking at routes that do not exist", () => {
        expect(index).not.toContain("/blog/category/");
        expect(article).not.toContain("/blog/category/");
        expect(article).not.toContain("/blog/tag/");
        expect(index).toContain("category: { slug: filter.category }");
        expect(index).toContain("tags: { some: { slug: filter.tag } }");
    });

    it("keeps the filter when paging", () => {
        // The index used to build its own `?page=N` hrefs, which is how a
        // filtered page two lost the filter. It hands the job to the shared
        // pager now; what that pager keeps is proven in
        // paging-keeps-the-query-it-found.test.tsx.
        expect(index).toContain('<Pagination');
        expect(index).toContain('pageParam="page"');
    });

    it("offers a way back to everything", () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module-sources/blog/module.json"), "utf8"));
        for (const locale of Object.keys(manifest.translations)) {
            expect(manifest.translations[locale].blog.allArticles, locale).toBeTruthy();
        }
    });
});

describe("userProfilePath", () => {
    /** Every module on: the convention is that an absent entry means enabled. */
    const ON: Record<string, boolean> = {};

    it("resolves through the module that claims the capability", () => {
        expect(userProfileRoutePattern(ON)).toBe("/player/[username]");
        expect(userProfilePath("ada", ON)).toBe("/player/ada");
    });

    it("encodes a name that would otherwise invent a path segment", () => {
        expect(userProfilePath("a/b", ON)).toBe("/player/a%2Fb");
    });

    it("has nowhere to point without a username", () => {
        expect(userProfilePath(null, ON)).toBeNull();
        expect(userProfilePath("", ON)).toBeNull();
    });

    it("stops linking when an admin turns the module off", () => {
        const off = { "player-profiles": false };
        expect(userProfileRoutePattern(off)).toBeNull();
        expect(userProfilePath("ada", off)).toBeNull();
    });

    it("is claimed by exactly one installed module, with a resolver behind it", () => {
        const manifest = JSON.parse(
            fs.readFileSync(path.join(ROOT, "module-sources/player-profiles/module.json"), "utf8"),
        ) as { routes: { path: string; userProfile?: boolean; resolver?: string }[] };
        const claimed = manifest.routes.filter((r) => r.userProfile);
        expect(claimed).toHaveLength(1);
        // Core links to this path, so an unknown username must answer 404
        // rather than render an empty page with a 200.
        expect(claimed[0].resolver).toBeTruthy();
    });
});

describe("core's own username links", () => {
    it("ask the registry rather than hardcoding a module's path", () => {
        for (const file of [
            "src/core/components/activity/ActivityFeedList.tsx",
            "src/app/[locale]/(admin)/admin/audit-log/page.tsx",
        ]) {
            const source = fs.readFileSync(path.join(ROOT, file), "utf8");
            expect(source, file).toContain("userProfilePath");
            expect(source, file).not.toContain("/profile/${");
            expect(source, file).not.toContain("/player/");
        }
    });
});
