// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { manifestRefCandidates } from "@/core/lib/module-manifest-schema";
import { relativePath, stripComments } from "./source-text";

/**
 * A block lays itself out by the box it was given, never by the screen.
 *
 * The same block stands in a full row, the page column or a third of it,
 * depending on the theme. A layout written with the screen's breakpoints
 * (`md:grid-cols-2`) is right for one of those: the homepage's news section
 * was two columns at 768px of screen whatever its own width, so in a third
 * of the page it would have been two columns of a hundred pixels. Every
 * block box is an inline-size container, so a block uses `@md:` and the
 * like, which answer to the box.
 */

const ROOT = process.cwd();

/** A Tailwind variant that answers to the screen's width. */
const VIEWPORT_VARIANT = /(?<![@\w-])(?:sm|md|lg|xl|2xl|max-sm|max-md|max-lg|max-xl|max-2xl):[!a-z-]/g;

export function viewportVariants(source: string): string[] {
    return [...stripComments(source).matchAll(VIEWPORT_VARIANT)].map((m) => m[0]);
}

/** Every file that draws a block: core's, and each module's declared ones. */
function blockFiles(): string[] {
    const files = fs.readdirSync(path.join(ROOT, "src/core/components/blocks"))
        .filter((name) => name.endsWith(".tsx"))
        .map((name) => path.join(ROOT, "src/core/components/blocks", name));
    const sources = path.join(ROOT, "module-sources");
    for (const id of fs.readdirSync(sources)) {
        const manifestFile = path.join(sources, id, "module.json");
        if (!fs.existsSync(manifestFile)) continue;
        const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { blocks?: { component: string }[] };
        for (const block of manifest.blocks ?? []) {
            const file = manifestRefCandidates(block.component).map((c) => path.join(sources, id, c)).find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
            if (file) files.push(file);
        }
    }
    return files;
}

describe("a block", () => {
    const files = blockFiles();

    it("has files to be read", () => {
        expect(files.some((f) => relativePath(ROOT, f).startsWith("src/core/components/blocks/"))).toBe(true);
    });

    it("is laid out by its box, not by the screen", () => {
        const offenders = files.flatMap((file) => viewportVariants(fs.readFileSync(file, "utf8")).map((v) => `${relativePath(ROOT, file)}: ${v}`));
        expect(offenders, "use @md: and the like, which answer to the block's own box").toEqual([]);
    });

    it("tells a screen breakpoint from a box one", () => {
        expect(viewportVariants('className="grid md:grid-cols-2 lg:gap-6"')).toEqual(["md:g", "lg:g"]);
        expect(viewportVariants('className="grid @md:grid-cols-2 @4xl:grid-cols-4 hover:text-primary"')).toEqual([]);
    });
});
