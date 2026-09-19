import { describe, it, expect } from "vitest";
import postcss from "postcss";
import fs from "node:fs";
import path from "node:path";
import dropRemoteImports from "../../scripts/postcss-drop-remote-imports.mjs";

/**
 * A stylesheet this app ships does not go and fetch another one.
 *
 * The removed block editor's stylesheet opened with
 * `@import "https://rsms.me/inter/inter.css"`, and it reaches public pages
 * through the module that renders a built page. Every first visit fetched a
 * stranger's stylesheet and three font files from it, on top of the Inter
 * this app already self hosts and, at the time, never used.
 *
 * The visible cost was movement. The remote copy registers under the same
 * family name, arrives after paint and is around ten percent wider than the
 * fallback, which was enough to wrap the navigation onto a second row.
 * Measured over a production build, nine public pages carried 0.05 to 0.12
 * of layout shift against a 0.1 budget, and cart carried 0.12.
 *
 * The build now drops those rules. The CSP no longer names the origin either,
 * so if this ever stops working the browser refuses the request instead of
 * quietly making it.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

async function run(css: string): Promise<string> {
    const result = await postcss([dropRemoteImports()]).process(css, { from: undefined });
    return result.css;
}

describe("the stylesheets this app ships", () => {
    it("drop an import that names another origin", async () => {
        const out = await run('@import "https://rsms.me/inter/inter.css";\n.a { color: red; }');
        expect(out).not.toContain("rsms.me");
        expect(out).toContain(".a { color: red; }");
    });

    it("drop it however the rule is written", async () => {
        const out = await run("@import url(http://example.com/a.css);\n@import url('https://example.com/b.css') screen;");
        expect(out.trim()).toBe("");
    });

    it("keep an import of a file that ships with the app", async () => {
        const css = '@import "./tokens.css";\n@import url("../theme.css");';
        expect(await run(css)).toBe(css);
    });

    it("are not written with a remote import in the first place", () => {
        const authored: string[] = [];
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.name.endsWith(".css")) {
                    const source = fs.readFileSync(full, "utf8");
                    if (/@import\s+(?:url\(\s*)?["']?https?:\/\//i.test(source)) {
                        authored.push(path.relative(ROOT, full));
                    }
                }
            }
        };
        for (const base of ["src", "module-sources"]) walk(path.join(ROOT, base));
        expect(authored, `these fetch a stylesheet from another origin:\n${authored.join("\n")}`).toEqual([]);
    });
});
