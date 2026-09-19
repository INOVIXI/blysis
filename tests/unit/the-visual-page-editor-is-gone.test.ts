// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * There is one editor for a custom page, and it is the one that writes words.
 *
 * A page has a single `content` column and two editors were pointed at it: a
 * rich text box, and a drag-and-drop block builder whose output was a JSON
 * document in the same column. The list gave each row a button for each, so
 * an operator chose an editor before writing anything and the choice decided
 * what the other editor would show them afterwards - a page built from blocks
 * opened in the text editor as a wall of JSON. Whichever one was used last
 * won, and nothing said so.
 *
 * The builder went. It carried a dependency of its own, a stylesheet that
 * fetched a font from somebody else's server, a manifest field, six block
 * components across five modules, four files of core machinery to merge them
 * and a whole second grammar for what a page is - all so that a page could be
 * assembled instead of written. The maintainer asked for it to go without a
 * trace, and this is the gate that keeps it gone.
 *
 * What a person writes is Markdown. That is already true of an article, a
 * forum post and a ticket reply, and it is now true of a page too.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Everything the repository is written in, minus what it copies or builds. */
function tree(): string[] {
    const out: string[] = [];
    const skip = new Set(["node_modules", ".next", ".next-prod", ".git", "modules", "generated", ".claude", "module-marketplace", "coverage"]);
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (skip.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.(ts|tsx|css|json|md)$/.test(entry.name) && entry.name !== "package-lock.json") out.push(full);
        }
    };
    walk(ROOT);
    return out;
}

const FILES = tree().filter((f) => f !== __filename);
const rel = (f: string) => path.relative(ROOT, f);

describe("the visual page editor", () => {
    it("has a repository to be absent from", () => {
        expect(FILES.length).toBeGreaterThan(500);
    });

    it("is named nowhere", () => {
        const named = FILES.filter((f) => /puck/i.test(fs.readFileSync(f, "utf8"))).map(rel);
        expect(named).toEqual([]);
    });

    it("is not a dependency", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
        const named = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => /puck/i.test(d));
        expect(named).toEqual([]);
    });

    it("left no block for a module to contribute", () => {
        const offenders: string[] = [];
        for (const id of fs.readdirSync(path.join(ROOT, "module-sources"))) {
            if (fs.existsSync(path.join(ROOT, "module-sources", id, "blocks"))) offenders.push(`${id}/blocks`);
            const manifest = path.join(ROOT, "module-sources", id, "module.json");
            if (!fs.existsSync(manifest)) continue;
            if (JSON.parse(fs.readFileSync(manifest, "utf8")).pageBlocks) offenders.push(`${id} declares pageBlocks`);
        }
        expect(offenders).toEqual([]);
    });

    it("left no way to declare one", () => {
        const schema = fs.readFileSync(path.join(ROOT, "src/core/lib/module-manifest-schema.ts"), "utf8");
        expect(schema).not.toContain("pageBlocks");
    });

    it("left none of the machinery that merged them", () => {
        const gone = [
            "src/core/lib/blocks.tsx",
            "src/core/lib/blocks-merger.ts",
            "src/core/lib/blocks-i18n.ts",
            "src/core/lib/use-merged-block-config.ts",
            "src/core/sdk/blocks.ts",
            "module-sources/custom-pages/pages/admin/builder",
        ].filter((p) => fs.existsSync(path.join(ROOT, p)));
        expect(gone).toEqual([]);
    });
});

describe("a page written with the old builder", () => {
    /**
     * Nobody's content is thrown away without saying so. A `content` column
     * holding the builder's JSON is not Markdown, and rendering it as Markdown
     * would put a wall of braces in front of a visitor. The page says what
     * happened instead, and the list says which pages it happened to, so an
     * operator can find them rather than hear about it from a reader.
     */
    const view = fs.readFileSync(path.join(ROOT, "module-sources/custom-pages/pages/public/[slug]/page.tsx"), "utf8");
    const lib = fs.readFileSync(path.join(ROOT, "module-sources/custom-pages/lib/validations.ts"), "utf8");

    it("is recognised rather than rendered", () => {
        expect(lib).toContain("wasBuiltWithBlocks");
        expect(view).toContain("wasBuiltWithBlocks");
    });

    it("says so in the reader's language", () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module-sources/custom-pages/module.json"), "utf8"));
        for (const locale of ["en", "tr"]) {
            expect(typeof manifest.translations[locale].customPages.builtWithBlocks).toBe("string");
        }
    });
});
