import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Everything shipped in `public/` is either used or explained.
 *
 * `public/` is served verbatim and never tree shaken, so a file nobody links
 * is dead weight that no build step can notice. Six of them were:
 * `background1.png` through `background6.png`, 8.4 MB of the repository's 8.3
 * MB `public/` directory, with no reference in any source file, no default in
 * the seed and no `Setting` row pointing at them. They were deleted with this
 * test.
 *
 * A reference here is deliberately loose - the file's name appearing anywhere
 * in the tree, including inside another public file, because that is how
 * `manifest.json` reaches the two icons. Loose is the right side to err on:
 * this gate exists to catch a megabyte nobody meant to keep, not to police
 * how an asset is addressed.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const PUBLIC = path.join(ROOT, "public");

/**
 * Files that no source names, with the reason each is still shipped. This list
 * may shrink; an addition to it needs a reason as good as these.
 */
const EXPLAINED: Record<string, string> = {
    ".well-known/security.txt": "RFC 9116 puts it at a fixed URL, so nothing links it by design",
};

/*
 * Two entries left this list rather than shrinking it by attrition.
 *
 * `manifest.json` was a static file with the product's own name, short name
 * and description written into it, so every installation put the same word
 * under the same home screen icon. It is `src/app/manifest.ts` now, built
 * from the operator's settings.
 *
 * `logo.png` was 48 KB explained here as "something to point the site logo
 * setting at" - a setting that did not exist. It does now, and pointing it at
 * the product's own mark is the thing the manifest route was written to stop,
 * so the file went with it.
 */

/** Runtime state rather than shipped content. */
const RUNTIME = ["uploads"];

function filesUnder(dir: string, base = ""): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            if (RUNTIME.includes(rel)) continue;
            out.push(...filesUnder(path.join(dir, entry.name), rel));
        } else if (entry.name !== ".gitkeep") {
            out.push(rel);
        }
    }
    return out;
}

const SCANNED = ["src/app", "src/core", "module-sources", "messages-core", "public", "scripts", "prisma"];
const TEXT = /\.(tsx?|jsx?|json|css|md|mjs|sh|ya?ml)$/;

/** Every tracked source file's text, in one string, read once. */
function corpus(): string {
    const parts: string[] = [];
    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules" || entry.name === "generated") continue;
                walk(full);
            } else if (TEXT.test(entry.name)) {
                parts.push(fs.readFileSync(full, "utf8"));
            }
        }
    };
    for (const dir of SCANNED) walk(path.join(ROOT, dir));
    return parts.join("\n");
}

describe("what is shipped in public", () => {
    const text = corpus();

    it("is referenced by something, or explained here", () => {
        const orphans = filesUnder(PUBLIC).filter((file) => {
            if (file in EXPLAINED) return false;
            const name = path.basename(file);
            // The file's own text is in the corpus, so a name that only
            // matches itself does not count as a reference.
            const hits = text.split(name).length - 1;
            return hits === 0;
        });

        expect(orphans, "delete these, or add them to EXPLAINED with a reason").toEqual([]);
    });

    it("does not carry the six background images again", () => {
        // 8.4 MB, added with nothing pointing at them and never noticed. The
        // check above would catch them again; this one names them, because a
        // reader deserves to know which files the number refers to.
        for (const n of [1, 2, 3, 4, 5, 6]) {
            expect(fs.existsSync(path.join(PUBLIC, `background${n}.png`))).toBe(false);
        }
    });

    it("explains nothing that does not exist", () => {
        // An entry left behind after its file went is a reason for something
        // nobody ships.
        for (const file of Object.keys(EXPLAINED)) {
            expect(fs.existsSync(path.join(PUBLIC, file)), `${file} is explained but not shipped`).toBe(true);
        }
    });
});
