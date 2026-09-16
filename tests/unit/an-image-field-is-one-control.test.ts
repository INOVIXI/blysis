/**
 * Every field that holds a file offers the same two ways to fill it.
 *
 * Three controls answered one question. `UrlOrFile` - link or upload - was
 * used in exactly one place. `FileUpload` - upload only, no way to paste an
 * address - was used in six. A bare `<Input placeholder="https://...">` -
 * link only, no way to upload, no preview - was used for the blog's cover
 * image, both of the SEO og:image fields and a member's avatar.
 *
 * Which one a field got was down to who wrote the screen. An operator
 * uploading a product image and then pasting a blog cover met two different
 * controls for the same job, and the blog could not take an upload at all
 * even though the platform has stored files since the first release.
 *
 * `UrlOrFile` is the control. `FileUpload` is how it uploads, and belongs to
 * it rather than to a screen. The manifest names a field by what it holds -
 * `image` or `file` - never by the control that draws it.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "generated") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith(".tsx")) out.push(full);
    }
    return out;
}

const FILES = [
    ...walk(path.join(ROOT, "src/app")),
    ...walk(path.join(ROOT, "src/core")),
    ...walk(path.join(ROOT, "module-sources")),
];
const rel = (f: string) => path.relative(ROOT, f);

/** The control `UrlOrFile` owns; nobody else reaches for it. */
const OWNS_THE_PICKER = "src/core/components/ui/url-or-file.tsx";

/** A name that says the field holds a picture. */
const HOLDS_AN_IMAGE = /\b\w*(image|avatar|cover|logo|banner|thumbnail)\w*\b/i;

/** The attributes of the JSX element opening at `start`. */
function openTag(source: string, start: number): string {
    let depth = 0;
    let i = start;
    for (; i < source.length; i++) {
        const c = source[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
    }
    return source.slice(start, i);
}

describe("a field that holds a file", () => {
    it("has screens to check", () => {
        expect(FILES.length).toBeGreaterThan(200);
    });

    it("is never a bare upload picker on a screen", () => {
        const offenders = FILES
            .filter((file) => rel(file) !== OWNS_THE_PICKER)
            .filter((file) => /<FileUpload\b/.test(fs.readFileSync(file, "utf8")))
            .map(rel)
            .sort();
        expect(offenders, "use UrlOrFile: a field that can be uploaded can also be linked").toEqual([]);
    });

    it("is never a bare text box, which can neither upload nor show what it holds", () => {
        const offenders: string[] = [];
        for (const file of FILES) {
            const source = fs.readFileSync(file, "utf8");
            for (const m of source.matchAll(/<Input\b/g)) {
                const attrs = openTag(source, m.index! + m[0].length);
                // What the box is bound to, not what its handler mentions.
                // Reading the whole tag called the help centre's lucide icon
                // field an image field, because clearing the image is what
                // choosing an icon does.
                const bound = /\bvalue=\{([^}]*)\}/.exec(attrs)?.[1] ?? "";
                if (!HOLDS_AN_IMAGE.test(bound)) continue;
                offenders.push(`${rel(file)}:${source.slice(0, m.index).split("\n").length}`);
            }
        }
        expect(offenders, "use UrlOrFile").toEqual([]);
    });

    it("is drawn by the two generic screens through the one control", () => {
        for (const screen of [
            "src/core/components/admin/AdminCrudPage.tsx",
            "src/core/components/admin/SettingsForm.tsx",
        ]) {
            const source = fs.readFileSync(path.join(ROOT, screen), "utf8");
            expect(source, screen).toContain("<UrlOrFile");
            expect(source, screen).not.toContain("<FileUpload");
        }
    });

    it("is named in a manifest by what it holds, not by the control", () => {
        const crud = fs.readFileSync(path.join(ROOT, "src/core/components/admin/AdminCrudPage.tsx"), "utf8");
        /*
         * The union itself, not the whole file. The comment above it explains
         * what `urlOrFile` was, and stripping comments first is not the way
         * out: this file contains `accept="image/*"`, whose `/*` opens a
         * comment a naive stripper then closes hundreds of lines later,
         * swallowing the switch it was meant to read.
         */
        const union = /type\?:\s*([^;]+);/.exec(crud)?.[1] ?? "";
        expect(union, "the field type union should be readable").toContain('"text"');
        expect(union, "`urlOrFile` names the control; `file` names the field").not.toContain("urlOrFile");
        expect(union).toContain('"image"');
        expect(union).toContain('"file"');
        expect(crud).toMatch(/case "image":/);
        expect(crud).toMatch(/case "file":/);
    });

    it("keeps the picker out of the SDK, so a module cannot draw half a field", () => {
        const sdk = fs.readFileSync(path.join(ROOT, "src/core/sdk/ui.ts"), "utf8");
        expect(sdk).toContain("UrlOrFile");
        expect(sdk).not.toContain("FileUpload");
    });
});
