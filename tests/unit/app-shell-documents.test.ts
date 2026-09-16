import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * No boundary file renders a document of its own.
 *
 * `not-found.tsx` and `error.tsx` are composed inside the layouts above them,
 * so one that carries its own `<html>` puts a document inside a document. The
 * served body then comes out empty: the right status, the markup only in the
 * flight payload, and nothing at all for a crawler, a text browser or a reader
 * with scripting off. Every mistyped URL on the demo was a blank page.
 *
 * Above `[locale]` there is no layout of ours, because this app's root layout
 * is `app/[locale]/layout.tsx`, a top-level dynamic segment. Next supplies the
 * document there itself - `.next/server/app/_not-found.html` shows the wrapper
 * it renders - so a boundary at that level nests a second document inside the
 * implicit one and produces the same empty body.
 *
 * `global-error.tsx` and `global-not-found.tsx` are the documented exceptions:
 * they are returned at the routing level rather than rendered inside a layout,
 * so each carries a document of its own. `globalNotFound` in next.config.ts is
 * what makes the 404 take that path.
 * See node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions.
 */

const APP = path.join(process.cwd(), "src/app");
const BOUNDARIES = new Set(["not-found.tsx", "error.tsx"]);

/**
 * Comments out, so that a file explaining why it renders no document does not
 * read as one that does.
 */

/** Does this file render a document root of its own? */
export function rendersDocument(source: string): boolean {
    return /<html[\s>]/.test(stripComments(source));
}

/**
 * The nearest layout at or above `dir` that renders a document, if any.
 *
 * A segment's own `layout.tsx` wraps that segment's boundary files, so the
 * search starts in the file's own directory rather than its parent.
 */
export function documentAncestor(dir: string, appRoot: string, read: (p: string) => string | null): string | null {
    let current = dir;
    for (;;) {
        const layout = path.join(current, "layout.tsx");
        const source = read(layout);
        if (source !== null && rendersDocument(source)) return layout;
        if (path.resolve(current) === path.resolve(appRoot)) return null;
        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

const readOrNull = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);

function boundaryFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules") continue;
                walk(full);
            } else if (BOUNDARIES.has(entry.name)) {
                found.push(full);
            }
        }
    };
    walk(APP);
    return found.sort();
}

describe("app shell documents", () => {
    const files = boundaryFiles();

    it("finds the boundary files it is meant to check", () => {
        expect(files.length).toBeGreaterThanOrEqual(4);
    });

    it("no boundary a layout composes renders a document of its own", () => {
        const nested = files.filter((file) => {
            const wrapper = documentAncestor(path.dirname(file), APP, readOrNull);
            return wrapper !== null && rendersDocument(fs.readFileSync(file, "utf8"));
        });
        expect(nested.map((f) => path.relative(APP, f))).toEqual([]);
    });

    it("every boundary nothing composes carries one", () => {
        const bare = files.filter((file) => {
            const wrapper = documentAncestor(path.dirname(file), APP, readOrNull);
            return wrapper === null && !rendersDocument(fs.readFileSync(file, "utf8"));
        });
        expect(bare.map((f) => path.relative(APP, f))).toEqual([]);
    });

    it("global-error carries its own document", () => {
        const globalError = path.join(APP, "global-error.tsx");
        expect(fs.existsSync(globalError)).toBe(true);
        expect(rendersDocument(fs.readFileSync(globalError, "utf8"))).toBe(true);
    });

    it("the locale not-found renders content, since the layout composes it", () => {
        expect(rendersDocument(fs.readFileSync(path.join(APP, "[locale]/not-found.tsx"), "utf8"))).toBe(false);
        expect(documentAncestor(path.join(APP, "[locale]"), APP, readOrNull)).toBe(path.join(APP, "[locale]/layout.tsx"));
    });

    // Self-tests: the checks above are only worth their runtime if they fail
    // on the shapes they exist to catch.
    it("rendersDocument sees a document root and nothing else", () => {
        expect(rendersDocument('return <html lang="en"><body /></html>;')).toBe(true);
        expect(rendersDocument("return <html>\n<body />\n</html>;")).toBe(true);
        expect(rendersDocument('return <div className="html-ish" />;')).toBe(false);
    });

    it("rendersDocument ignores a document named in a comment", () => {
        expect(rendersDocument("/** used to carry its own <html> and <body>. */\nreturn <main />;")).toBe(false);
        expect(rendersDocument("// never render <html> here\nreturn <main />;")).toBe(false);
        expect(rendersDocument("/* comment */\nreturn <html><body /></html>;")).toBe(true);
    });

    it("stripComments leaves a protocol-relative URL alone", () => {
        expect(stripComments('const u = "https://example.test/x"; // trailing')).toBe('const u = "https://example.test/x"; ');
    });

    it("documentAncestor walks up and stops at the app root", () => {
        const layouts: Record<string, string> = {
            "/app/[locale]/layout.tsx": "<html><body>{children}</body></html>",
        };
        const read = (p: string) => layouts[p] ?? null;
        expect(documentAncestor("/app/[locale]/(public)/blog", "/app", read)).toBe("/app/[locale]/layout.tsx");
        expect(documentAncestor("/app/[locale]", "/app", read)).toBe("/app/[locale]/layout.tsx");
        expect(documentAncestor("/app", "/app", read)).toBeNull();
    });

    it("documentAncestor ignores a layout that renders no document", () => {
        const read = (p: string) => (p === "/app/[locale]/layout.tsx" ? "<div>{children}</div>" : null);
        expect(documentAncestor("/app/[locale]/blog", "/app", read)).toBeNull();
    });
});
