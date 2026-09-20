import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Every cover picture is drawn in the same frame.
 *
 * A product banner, an article cover, a category tile and a showcase shot are
 * one kind of picture doing one job, and each screen had chosen its own shape
 * for it: 2:1 on a product card, 16:9 on a news card and on the product page's
 * own gallery, a flat 128 pixels on a category tile, 160 on the homepage
 * block. One artwork uploaded once was cropped four ways - the top and bottom
 * of a rank banner appeared and disappeared as a shopper moved from the shelf
 * to the product - and a row that mixed two of them did not line up.
 *
 * So there is one ratio, `aspect-card`, declared in `globals.css`, and this
 * holds every cover to it. Two rules: the token exists, and nothing draws a
 * picture box in another shape unless it is listed below with a reason.
 *
 * `aspect-square` is not a cover - it is a thumbnail of an arbitrary upload,
 * where cropping to a wide strip would hide what the file is - and the
 * exceptions are the two places where the shape *is* the content.
 */

const ROOT = process.cwd();
const SCANNED = ["src/core", "src/app", "module-sources"];

/** Ratios that are not covers, each with the reason it is not. */
const NOT_A_COVER: { file: string; utility: string; why: string }[] = [
    {
        file: "module-sources/slider/widgets/slider-widget.tsx",
        utility: "aspect-[21/9]",
        why: "a homepage hero banner, cinematic on purpose and never beside a card",
    },
    {
        file: "module-sources/wheel/pages/public/page.tsx",
        utility: "aspect-square",
        why: "the wheel itself, which is round",
    },
    {
        file: "src/core/components/ui/media-picker.tsx",
        utility: "aspect-square",
        why: "a thumbnail of an arbitrary upload, not a cover for anything",
    },
    {
        file: "src/app/[locale]/(admin)/admin/media/page.tsx",
        utility: "aspect-square",
        why: "the same grid of uploads, in the admin",
    },
];

const ASPECT = /\baspect-(?!card\b)[a-z0-9[\]/.-]+/g;

function tsxFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (at: string) => {
        if (!fs.existsSync(at)) return;
        for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
            if (entry.name === "node_modules") continue;
            const full = path.join(at, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".tsx")) out.push(full);
        }
    };
    walk(path.join(ROOT, dir));
    return out;
}

describe("a cover is two to one", () => {
    it("declares the ratio once, where a theme can see it", () => {
        const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
        expect(css).toMatch(/--aspect-card:\s*2\s*\/\s*1;/);
    });

    it("draws every cover in it", () => {
        const allowed = new Set(NOT_A_COVER.map((e) => `${e.file}:${e.utility}`));
        const offenders: string[] = [];
        for (const dir of SCANNED) {
            for (const file of tsxFiles(dir)) {
                const relative = path.relative(ROOT, file);
                const source = fs.readFileSync(file, "utf8");
                for (const match of source.match(ASPECT) ?? []) {
                    if (allowed.has(`${relative}:${match}`)) continue;
                    offenders.push(`${relative}: ${match}`);
                }
            }
        }
        expect(offenders, offenders.join("\n")).toEqual([]);
    });

    it("sets no full-width picture box a fixed height instead", () => {
        // The other way to get a shape: a box as wide as its column with
        // `h-32` on it and `object-cover` inside. That is a ratio chosen at
        // whatever width somebody had open, and it changes at every other one.
        //
        // A box with a fixed width as well is a different thing - an avatar, a
        // thumbnail in a form - and it keeps its shape everywhere, so it is
        // not what this is about.
        const offenders: string[] = [];
        for (const dir of SCANNED) {
            for (const file of tsxFiles(dir)) {
                const source = fs.readFileSync(file, "utf8");
                for (const match of source.matchAll(/className="([^"]*\bobject-cover\b[^"]*)"/g)) {
                    const classes = match[1];
                    const fixedHeight = /\bh-\d/.test(classes) && !/\bh-full\b/.test(classes);
                    const fixedWidth = /\bw-\d/.test(classes);
                    if (fixedHeight && !fixedWidth) {
                        offenders.push(`${path.relative(ROOT, file)}: ${classes.slice(0, 70)}`);
                    }
                }
            }
        }
        expect(offenders, offenders.join("\n")).toEqual([]);
    });
});
