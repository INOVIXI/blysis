import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * Author-written HTML reaches the page through one component.
 *
 * Seven module screens each imported DOMPurify, called `sanitize` with its
 * own defaults, and rendered the result through `prose dark:prose-invert` -
 * class names that match nothing, because the typography plugin was never
 * installed here. So the writing on the blog, the forum, the help centre, the
 * changelog, custom pages and every product description came out with
 * body-sized headings and unmarked lists, and seven sanitiser configurations
 * were free to drift apart.
 *
 * Six of the seven imported plain `dompurify`, which needs a window. They are
 * client components whose content arrives after mount, so the first render
 * has nothing to sanitise and the missing DOM never shows. That is luck, not
 * design: the day one of them renders its content on the server, it throws.
 *
 * `RichContent` is the one place. It sanitises with the isomorphic build and
 * styles with `.blysis-content`, in the theme's colours.
 */

const ROOT = path.resolve(__dirname, "../..");

function tsxFiles(dir: string, into: string[] = []): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return into;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "node_modules") tsxFiles(full, into);
        } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
            into.push(full);
        }
    }
    return into;
}

const MODULE_FILES = tsxFiles(path.join(ROOT, "module-sources"));
const rel = (file: string) => path.relative(ROOT, file);

/** Structured data is markup for a crawler, not writing for a reader. */
const JSON_LD = /Jsonld|JsonLd|jsonLd|JSON_LD/;

/** The core version that first exported RichContent. */
const INTRODUCED_IN = [1, 21, 0] as const;

/** `a >= b`, comparing major, minor and patch in order. */
function atLeast(a: number[], b: readonly number[]): boolean {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] > b[i];
    }
    return true;
}

describe("what a person wrote", () => {
    it("has module files to read", () => {
        expect(MODULE_FILES.length).toBeGreaterThan(200);
    });

    it("is not sanitised by each module for itself", () => {
        const offenders = MODULE_FILES.filter((file) =>
            /from "(?:isomorphic-)?dompurify"/.test(fs.readFileSync(file, "utf8")),
        ).map(rel);
        expect(offenders).toEqual([]);
    });

    it("is not written into the page by a module directly", () => {
        const offenders: string[] = [];
        for (const file of MODULE_FILES) {
            const source = fs.readFileSync(file, "utf8");
            for (const hit of source.matchAll(/dangerouslySetInnerHTML=\{\{\s*__html:\s*([^}]+)\}\}/g)) {
                if (JSON_LD.test(hit[1])) continue;
                offenders.push(`${rel(file)}: ${hit[1].trim()}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("keeps no class from a typography plugin this project does not have", () => {
        // `prose`, and the `dark:` variant that never fires on a panel that
        // switches modes with [data-mode="dark"].
        const offenders: string[] = [];
        for (const file of MODULE_FILES) {
            // Comments are prose about prose: a note explaining why a column
            // of text is the width it is used to fail this.
            const source = stripComments(fs.readFileSync(file, "utf8"));
            if (/\bprose(?:-[a-z]+)?\b/.test(source)) offenders.push(`${rel(file)}: prose`);
            if (/\bdark:[a-z]/.test(source)) offenders.push(`${rel(file)}: dark:`);
        }
        expect(offenders).toEqual([]);
    });

    it("is styled by core, in the theme's colours", () => {
        const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
        expect(css).toContain(".blysis-content");
        for (const selector of ["h1", "ul", "ol", "blockquote", "code", "pre", "a", "table"]) {
            expect(css, `.blysis-content ${selector}`).toMatch(
                new RegExp(String.raw`\.blysis-content[^{]*\b${selector}\b[^{]*\{`),
            );
        }
        // Fixed colours here would be the same drift the panel gate keeps out.
        const block = css.slice(css.indexOf(".blysis-content"));
        const content = block.slice(0, block.indexOf("\n.text-gradient"));
        expect(content).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgb\(|\bhsl\(/);
    });

    /**
     * A row of badges is a row.
     *
     * Tailwind's preflight makes every `img` a block, so three badges written
     * on three lines - the shape every project page opens with - came out
     * stacked down the page one per line, each on its own row. Measured in
     * the editor's preview against the real document: twelve images, twelve
     * rows. They are inline by default now, and only an image that is a
     * paragraph on its own is treated as a figure and given the room and the
     * rounded corner that go with one.
     */
    it("lets images written side by side sit side by side", () => {
        const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
        const rule = css.slice(css.indexOf(".blysis-content img"));
        const shared = rule.slice(0, rule.indexOf("}"));
        expect(shared).toContain("display: inline-block");
        // The figure case, which is what the block display is actually for.
        expect(css).toContain(".blysis-content p > img:only-child");
        expect(css).toContain(".blysis-content p > a:only-child > img");
    });

    /**
     * A top-level heading is ruled off.
     *
     * The line under a title in a rendered README is not something anybody
     * typed - the source carries no `---` at all - it is a border the
     * stylesheet puts under `h1` and `h2`, the way every markdown host draws
     * them. Without it a long page is a run of bold lines and a reader has to
     * find the seams themselves.
     *
     * Only the two top levels. An `h3` ruled off as well turns a page with
     * sub-sections into a ladder.
     */
    it("rules off the headings that divide a page", () => {
        const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
        const rule = css.slice(css.indexOf(".blysis-content h1,\n.blysis-content h2 {"));
        expect(rule.slice(0, rule.indexOf("}"))).toContain("border-bottom");
        // A writer's own `---` keeps its own rule, which is a different thing.
        expect(css).toContain(".blysis-content hr");
    });

    /**
     * A heading inside an article is not lighter than the title above it.
     *
     * Measured on the running site: the page `h1` renders at 700 and the
     * headings inside `blysis-content` at 600, so a section heading in a long
     * article read as quieter than its own page title - which inverts what
     * the two are for. Modrinth, which is the reference here, sets its titles
     * at 800 against body text at 500; the point is the contrast, not the
     * number.
     */
    it("sets an article's headings no lighter than the page's own title", () => {
        const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
        const block = css.slice(css.indexOf(".blysis-content h1,"));
        const weight = /font-weight:\s*(\d+)/.exec(block.slice(0, block.indexOf("}")));
        expect(weight, "the heading block should state a weight").not.toBeNull();
        expect(Number(weight![1])).toBeGreaterThanOrEqual(700);
    });

    it("is reachable by a module", () => {
        const sdk = fs.readFileSync(path.join(ROOT, "src/core/sdk/ui.ts"), "utf8");
        expect(sdk).toContain("RichContent");
        const component = fs.readFileSync(path.join(ROOT, "src/core/components/ui/rich-content.tsx"), "utf8");
        // The sanitising moved one file along, into `renderMarkdown`, because
        // the editor's preview has to clean the same way the page does or it
        // is showing a writer something the page will not print.
        expect(component).toContain("renderMarkdown(markdown,");
        expect(component).toContain("blysis-content");
        const markdown = fs.readFileSync(path.join(ROOT, "src/core/lib/markdown.ts"), "utf8");
        expect(markdown).toContain('from "isomorphic-dompurify"');
        expect(markdown).toContain("DOMPurify.sanitize(");
    });

    it("is required by every module that renders it", () => {
        // A module using an SDK symbol from 1.21.0 must ask for at least it.
        //
        // Asking for the floor rather than the exact string: this was written
        // as `toBe("^1.21.0")` against both core's own constant and every
        // module's range, which made the next unrelated addition to the SDK
        // fail this test. A module that later needs 1.22.0 still gets
        // RichContent, and pinning would have forced it to lie about that.
        const version = fs.readFileSync(path.join(ROOT, "src/core/lib/core-version.ts"), "utf8");
        const core = version.match(/CORE_API_VERSION = "(\d+)\.(\d+)\.(\d+)"/);
        expect(core, "core-version.ts must declare CORE_API_VERSION").toBeTruthy();
        expect(atLeast(core!.slice(1, 4).map(Number), INTRODUCED_IN)).toBe(true);

        const users = MODULE_FILES.filter((f) => /\bRichContent\b/.test(fs.readFileSync(f, "utf8")));
        expect(users.length).toBeGreaterThan(5);
        for (const file of users) {
            const id = path.relative(path.join(ROOT, "module-sources"), file).split(path.sep)[0];
            const manifest = JSON.parse(
                fs.readFileSync(path.join(ROOT, "module-sources", id, "module.json"), "utf8"),
            ) as { coreVersion: string };
            const asked = manifest.coreVersion.match(/\^(\d+)\.(\d+)\.(\d+)/);
            expect(asked, `${id} declares ${manifest.coreVersion}`).toBeTruthy();
            expect(atLeast(asked!.slice(1, 4).map(Number), INTRODUCED_IN), id).toBe(true);
            // And a range the core it runs against actually satisfies. This
            // used to read "same major as the version RichContent arrived in",
            // which was the same thing while there had only ever been one
            // major and stopped being true the moment there were two: a module
            // asking for ^2.0.0 gets RichContent, and asking for ^1.x would
            // mean it cannot run on the core that is shipping.
            expect(asked![1], `${id} asks for a major the core is not on`)
                .toBe(core![1]);
        }
    });
});
