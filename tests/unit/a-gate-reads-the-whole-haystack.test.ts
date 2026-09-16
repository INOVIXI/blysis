/**
 * A gate that scans source reads all of it.
 *
 * Every gate here that asks a structural question strips comments first, and
 * twenty of them had each written the same two-line regex. It cannot tell a
 * `/*` inside a string from the start of a comment, so `accept="image/*"`
 * opened a comment that ran to the next `*​/` anywhere in the file. Measured
 * across `src`, `scripts` and `module-sources`: 39 files carry one, and on 14
 * the strip swallowed far more than their comments.
 *
 * The failure mode is silence. A gate cannot report an offender in a passage
 * its own stripper deleted, so the suite goes green on a haystack with holes
 * in it - which is how a scan stops being evidence.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

const ROOT = process.cwd();

describe("the shared stripper", () => {
    it("takes a block comment", () => {
        expect(stripComments("a /* gone */ b")).toBe("a  b");
    });

    it("takes a line comment", () => {
        expect(stripComments("a // gone\nb")).toBe("a \nb");
    });

    it("leaves a slash-star inside a string exactly where it was", () => {
        const src = 'const a = "image/*";\nconst b = 1;';
        expect(stripComments(src)).toBe(src);
    });

    it("leaves the rest of the file behind a string-embedded slash-star", () => {
        const src = 'accept="image/*"\ncase "file":\nconst after = 1;';
        expect(stripComments(src)).toContain('case "file":');
        expect(stripComments(src)).toContain("const after");
    });

    it("does not mistake a quote inside a comment for a string", () => {
        expect(stripComments('/* it\'s fine */ const a = 1;')).toBe(" const a = 1;");
    });

    it("keeps an escaped quote from ending its string", () => {
        const src = 'const a = "he said \\"/*\\" once";\nconst b = 2;';
        expect(stripComments(src)).toBe(src);
    });
});

describe("the gates that scan source", () => {
    const TESTS = fs
        .readdirSync(path.join(ROOT, "tests/unit"))
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => path.join(ROOT, "tests/unit", f));

    it("finds gates to check", () => {
        expect(TESTS.length).toBeGreaterThan(100);
    });

    it("none of them writes its own comment stripper", () => {
        const offenders: string[] = [];
        for (const file of TESTS) {
            // The stripper and this gate both quote the broken shape in order
            // to explain it. Reading their prose as code would fail the pair
            // that exist to describe the failure.
            if (/source-text\.ts$|a-gate-reads-the-whole-haystack/.test(file)) continue;
            const source = fs.readFileSync(file, "utf8");
            // The shape that cannot see a string: a block-comment regex.
            if (/replace\(\s*\/\\\/\\\*\[\\s\\S\]\*\?\\\*\\\//.test(source)) {
                offenders.push(path.relative(ROOT, file));
            }
        }
        expect(offenders, "import { stripComments } from './source-text'").toEqual([]);
    });
});
