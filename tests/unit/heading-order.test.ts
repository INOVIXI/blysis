import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { stripComments } from "./source-text";

/**
 * A heading rank is document structure, not a font size.
 *
 * Screen reader users navigate a page by its headings, and a rank that jumps
 * (h1 straight to h3) tells them a section is missing. The product shipped
 * three separate versions of that defect:
 *
 *  - `CardTitle` was a hardcoded `<h3>`. Cards sit directly under a page's
 *    `<h1>` nearly everywhere here, so every card on every screen skipped a
 *    level. It is now polymorphic and defaults to `h2`.
 *  - The footer titled its three columns with `<h4>`, so every page in the
 *    product ended h1 -> h4.
 *  - Twenty-one page files jumped from their own `<h1>` to an `<h3>`, and the
 *    setup wizard and the theme settings screen had no `<h1>` at all.
 *
 * The rules below are what keeps that from coming back.
 */

const root = path.resolve(import.meta.dirname, "../..");
const SCANNED = ["src/app", "src/core/components", "module-sources"];

/**
 * Catch-all routers render whatever component a module's manifest names, so
 * the `<h1>` lives in the module, not here. Nothing else is exempt.
 */
const PAGES_WITHOUT_OWN_H1 = new Set([
    "src/app/[locale]/[...slug]/page.tsx",
    "src/app/[locale]/(admin)/admin/[...slug]/page.tsx",
]);

/** Chrome that renders on top of every page, so its sections are siblings of the page `<h1>`. */
const SHARED_CHROME = [
    "src/core/components/layout/Footer.tsx",
    "src/core/components/layout/Navbar.tsx",
    "src/core/components/layout/MobileMenu.tsx",
];

function tsxFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) tsxFiles(full, out);
        else if (entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
}

/** Block comments and whole-line `//` comments. A doc comment naming `<h3>` is not markup. */

export function headingLevels(source: string): number[] {
    return [...stripComments(source).matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
}

/** Every place a file's heading ranks jump by more than one, as `h1->h3`. */
export function headingSkips(source: string): string[] {
    const levels = headingLevels(source);
    const skips: string[] = [];
    for (let i = 1; i < levels.length; i++) {
        if (levels[i] > levels[i - 1] + 1) skips.push(`h${levels[i - 1]}->h${levels[i]}`);
    }
    return skips;
}

const RELATIVE = /^\.{1,2}\//;

function resolveImport(spec: string, fromFile: string): string[] {
    let base: string;
    if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
    else if (RELATIVE.test(spec)) base = path.resolve(path.dirname(fromFile), spec);
    else return [];
    return [".tsx", ".ts", "/index.tsx", "/index.ts"]
        .map((ext) => base + ext)
        .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

/**
 * Whether a page renders an `<h1>` itself or through a component it imports.
 * Barrel files (`@/core/sdk/*`) mean the chain is a few hops long, so this
 * follows imports to a small depth rather than only looking at the page.
 */
export function reachesAnH1(file: string, depth = 0, seen = new Set<string>()): boolean {
    if (depth > 3 || seen.has(file)) return false;
    seen.add(file);
    if (!fs.existsSync(file)) return false;
    const source = stripComments(fs.readFileSync(file, "utf8"));
    if (/<h1[\s>]/.test(source) || /as=["']h1["']/.test(source)) return true;
    for (const [, spec] of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        for (const target of resolveImport(spec, file)) {
            if (reachesAnH1(target, depth + 1, seen)) return true;
        }
    }
    return false;
}

const allTsx = SCANNED.flatMap((dir) => tsxFiles(path.join(root, dir)));
const pageFiles = allTsx.filter((f) => path.basename(f) === "page.tsx");
const rel = (f: string) => path.relative(root, f);

/**
 * A page whose whole job is to send the reader somewhere else.
 *
 * `/admin/settings` is a group of sections with nothing of its own; the path
 * an operator remembers answered 404 until it got a page that redirects to
 * the first section. Such a page renders no markup at all, so it has no
 * heading to give and no title to take. That is a property of the file, not
 * an exception somebody has to remember - hence a test rather than a list.
 */
function onlyRedirects(file: string): boolean {
    const source = stripComments(fs.readFileSync(file, "utf8"));
    if (!/\bredirect\s*\(/.test(source)) return false;
    // Nothing is returned and nothing is rendered: no JSX anywhere in it.
    return !/<[A-Za-z]/.test(source);
}

describe("heading ranks", () => {
    it("scans the whole product, not a sample", () => {
        expect(allTsx.length).toBeGreaterThan(200);
        expect(pageFiles.length).toBeGreaterThan(100);
    });

    it("never skips a level inside a file", () => {
        const offenders = allTsx
            .map((f) => ({ file: rel(f), skips: headingSkips(fs.readFileSync(f, "utf8")) }))
            .filter((r) => r.skips.length > 0)
            .map((r) => `${r.file}: ${r.skips.join(", ")}`);
        expect(offenders).toEqual([]);
    });

    it("gives every page an h1 of its own or through a component it renders", () => {
        const offenders = pageFiles
            .map(rel)
            .filter((f) => !PAGES_WITHOUT_OWN_H1.has(f))
            .filter((f) => !onlyRedirects(path.join(root, f)))
            .filter((f) => !reachesAnH1(path.join(root, f)));
        expect(offenders).toEqual([]);
    });

    it("exempts only the two catch-all routers, and they still exist", () => {
        for (const f of PAGES_WITHOUT_OWN_H1) {
            expect(fs.existsSync(path.join(root, f)), `${f} is exempt but missing`).toBe(true);
        }
    });

    it("keeps shared chrome at h2, since its sections sit beside the page h1", () => {
        const offenders: string[] = [];
        for (const f of SHARED_CHROME) {
            const full = path.join(root, f);
            if (!fs.existsSync(full)) continue;
            const deep = headingLevels(fs.readFileSync(full, "utf8")).filter((l) => l > 2);
            if (deep.length) offenders.push(`${f}: h${deep.join(", h")}`);
        }
        expect(offenders).toEqual([]);
    });
});

describe("CardTitle", () => {
    const cardPath = path.join(root, "src/core/components/ui/card.tsx");
    const card = fs.readFileSync(cardPath, "utf8");

    it("does not hardcode a heading rank", () => {
        expect(stripComments(card)).not.toMatch(/<h[1-6][\s>]/);
    });

    it("defaults to h2 and takes an `as` override", () => {
        expect(card).toMatch(/as\s*\?\?\s*"h2"/);
        expect(card).toMatch(/as\?:\s*CardTitleTag/);
    });

    it("keeps the same classes, so the change is structural and not visual", () => {
        expect(card).toContain("text-lg font-semibold leading-none tracking-tight");
    });
});

describe("the scanner itself", () => {
    it("reads a skip", () => {
        expect(headingSkips("<h1>a</h1><h3>b</h3>")).toEqual(["h1->h3"]);
    });

    it("allows going back up any distance", () => {
        expect(headingSkips("<h1>a</h1><h2>b</h2><h3>c</h3><h1>d</h1>")).toEqual([]);
    });

    it("ignores a heading named in a comment", () => {
        expect(headingLevels("/* used to be a <h3> */\n<h1>a</h1>")).toEqual([1]);
        expect(headingLevels("// was <h4>\n<h1>a</h1>")).toEqual([1]);
    });

    it("does not mistake a component for a heading", () => {
        expect(headingLevels("<h1>a</h1><header>b</header><html>c</html>")).toEqual([1]);
    });
});
