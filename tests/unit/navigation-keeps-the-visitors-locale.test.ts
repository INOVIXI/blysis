import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * A link does not send a Turkish visitor to the English page.
 *
 * `localePrefix` is `always`, so every real path carries `/tr` or `/en`. A
 * navigation written without one is not a broken link - it resolves - which is
 * why these survived: the proxy rewrites the bare path to the default locale,
 * so `/auth/login` quietly becomes `/en/auth/login`. The visitor lands on the
 * page they asked for, in a language they may not read.
 *
 * The worst of them was the admin gate. `redirect("/auth/login")` in the admin
 * layout meant every signed-out visitor of `/tr/admin` arrived at the English
 * login form, and this was reproducible on the demo before the fix:
 *
 *     curl -sIL /tr/admin  ->  /en/auth/login
 *
 * `next/link` and `next/navigation` know nothing about locales. The wrappers
 * in `@/core/lib/i18n/navigation` - published to modules as
 * `@/core/sdk/navigation` - carry the active prefix, and the SDK file has said
 * so in a comment since it was written with nothing enforcing it.
 *
 * `usePathname` is deliberately not covered here. Both versions are correct
 * for different jobs: next-intl's strips the prefix, `next/navigation`'s keeps
 * it, and a callbackUrl built for a round trip back to this page needs the one
 * that keeps it.
 */

const ROOT = process.cwd();
const DIRS = ["src/app", "src/core", "module-sources"];

/**
 * Files that navigate without a locale on purpose. Each entry is a decision,
 * not a backlog.
 */
const NO_LOCALE_TO_CARRY: Record<string, string> = {
    "src/app/not-found.tsx":
        "The root not-found renders outside the [locale] segment, for a path that never matched one. There is no active locale to keep, and the next-intl Link would throw looking for the context.",
};

function walk(dir: string, out: string[] = []): string[] {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) return out;
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel, out);
        else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(rel);
    }
    return out;
}

const FILES = DIRS.flatMap((d) => walk(d));

function read(file: string): string {
    return stripComments(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

/** The import statements only, so a mention inside a comment or string is not a match. */
function imports(src: string): string {
    return (src.match(/^import [\s\S]*?from ["'][^"']+["'];/gm) ?? []).join("\n");
}

/** An app path, as opposed to an API route, an asset or an absolute URL. */
function isAppPath(href: string): boolean {
    if (!href.startsWith("/")) return false;
    if (href.startsWith("//")) return false;
    if (href.startsWith("/${") || href.startsWith("/api/")) return false;
    return !/^\/(uploads|images|favicon|robots|sitemap|_next)\b/.test(href);
}

describe("navigation keeps the visitor's locale", () => {
    it("no page links with next/link", () => {
        const offenders = FILES.filter((f) => !NO_LOCALE_TO_CARRY[f]).filter((f) =>
            /import\s+Link\s+from\s+["']next\/link["']/.test(imports(read(f))),
        );
        expect(offenders, "import Link from @/core/lib/i18n/navigation or @/core/sdk/navigation").toEqual([]);
    });

    it("no page redirects or routes through next/navigation", () => {
        const offenders: string[] = [];
        for (const file of FILES) {
            if (NO_LOCALE_TO_CARRY[file]) continue;
            const m = imports(read(file)).match(/import\s*\{([^}]*)\}\s*from\s*["']next\/navigation["']/);
            if (!m) continue;
            for (const name of m[1].split(",").map((n) => n.trim())) {
                // `usePathname` is a deliberate choice, `useParams`,
                // `useSearchParams` and `notFound` have no locale-aware twin.
                if (name === "redirect" || name === "useRouter") {
                    offenders.push(`${file}: ${name}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("a hard reload writes the locale into the path", () => {
        const offenders: string[] = [];
        for (const file of FILES) {
            for (const m of read(file).matchAll(/window\.location\.href\s*=\s*["'`]([^"'`]*)/g)) {
                if (isAppPath(m[1])) offenders.push(`${file}: ${m[1]}`);
            }
        }
        expect(offenders, "prefix with the locale from useLocale()").toEqual([]);
    });

    it("the locale-aware redirect is annotated so it still narrows", () => {
        // Without the annotation TypeScript does not treat a destructured
        // `never`-returning call as terminating, and every guard after one
        // reads as possibly-null.
        const nav = read("src/core/lib/i18n/navigation.ts");
        expect(nav).toContain("export const redirect: typeof navigation.redirect");
    });

    it("the SDK publishes the wrappers a module needs", () => {
        const sdk = read("src/core/sdk/navigation.ts");
        for (const name of ["Link", "useRouter", "redirect", "usePathname"]) {
            expect(sdk, `@/core/sdk/navigation must export ${name}`).toContain(name);
        }
    });

    it("every allowlisted file exists and carries a reason", () => {
        for (const [file, reason] of Object.entries(NO_LOCALE_TO_CARRY)) {
            expect(fs.existsSync(path.join(ROOT, file)), `${file} is gone`).toBe(true);
            expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(40);
        }
    });
});
