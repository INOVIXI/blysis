/**
 * What a writer typed is what the database holds.
 *
 * Content was HTML, so it was cleaned on the way in: every endpoint that
 * stored a body ran it through `sanitizeHtml` first, and the reasoning was
 * sound while the column held markup - a payload that never reaches the
 * database cannot be served from it.
 *
 * It stopped being sound when the column started holding Markdown. Measured
 * on 2026-09-15 against the real document a maintainer pasted in:
 *
 *   - `<div align="center">` was stored as `<div>`, so the centred front
 *     matter every project page opens with was not centred.
 *   - Seven `<details>` sections vanished outright, summaries and all.
 *   - `<kbd>` vanished.
 *   - A fenced code block documenting `<script>` was stored **empty**. The
 *     sanitiser has no idea what a code fence is; the writer's own example
 *     was deleted for looking like the thing it was explaining.
 *   - `a < b` in prose was stored as `a &lt; b` and rendered as those five
 *     characters.
 *
 * So the cleaning moved to where it can tell the difference. `renderMarkdown`
 * sees the parser's output, where a fenced block has already been escaped
 * into text, and it holds every tag to one explicit allowlist. Two gates keep
 * that the only door: `raw-html-reaches-a-page-only-through-a-decision` says
 * no module writes HTML into a page itself, and
 * `one-component-renders-what-a-person-wrote` says no module sanitises for
 * itself. Nothing executable reaches a reader; the database holds the text.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function sources(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) sources(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

const FILES = [
    ...sources(path.join(ROOT, "module-sources")),
    ...sources(path.join(ROOT, "src/app")),
    ...sources(path.join(ROOT, "src/core")),
];

describe("a body a writer submitted", () => {
    it("has files to check", () => {
        expect(FILES.length).toBeGreaterThan(400);
    });

    it("is stored as the writer typed it", () => {
        const offenders: string[] = [];
        for (const file of FILES) {
            const source = fs.readFileSync(file, "utf8");
            for (const hit of source.matchAll(/\bsanitizeHtml\s*\(/g)) {
                offenders.push(
                    `${path.relative(ROOT, file)}:${source.slice(0, hit.index).split("\n").length}`,
                );
            }
        }
        expect(offenders, "strip it on the way out, where a code fence is already text").toEqual([]);
    });

    it("leaves nobody an import of the helper that used to do it", () => {
        expect(fs.existsSync(path.join(ROOT, "src/core/lib/sanitize.ts"))).toBe(false);
        const sdk = fs.readFileSync(path.join(ROOT, "src/core/sdk/server.ts"), "utf8");
        expect(sdk).not.toContain("sanitizeHtml");
    });
});
