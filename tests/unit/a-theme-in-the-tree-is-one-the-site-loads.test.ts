import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { themeManifestSchema } from "@/core/lib/theme-manifest-schema";

/**
 * Every theme in the tree is one the site will load.
 *
 * The theme generator reads each `theme.json` through the manifest schema and
 * leaves out one that fails, with a line on the console and nothing else: the
 * build passes and the theme is simply not there. Vanguard went missing that
 * way when its heading font stack grew past the 100 characters a token value
 * may be, and every test that read its manifest straight off the disk still
 * passed, because none of them asked the schema.
 */

const THEMES = path.join(process.cwd(), "src/themes");

describe("a theme in the tree is one the site loads", () => {
    const dirs = fs.readdirSync(THEMES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

    it("finds the themes", () => {
        expect(dirs.length).toBeGreaterThan(0);
    });

    for (const dir of dirs) {
        it(`${dir} passes the manifest schema under its own name`, () => {
            const manifest = JSON.parse(fs.readFileSync(path.join(THEMES, dir, "theme.json"), "utf8"));
            const parsed = themeManifestSchema.safeParse(manifest);
            expect(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
            expect(manifest.id).toBe(dir);
        });
    }
});
