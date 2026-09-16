import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { join } from "node:path";
import { categoryTone } from "../../src/app/[locale]/(admin)/admin/modules/module-display";
import { stripComments } from "./source-text";

/**
 * The panel paints a category it has never heard of.
 *
 * The manifest schema says it plainly: `category` is free text "so core owns
 * no category vocabulary - the catalog groups by whatever values are
 * present". The panel then kept a map of five it did know - commerce,
 * community, management, gaming, content - and fell through to grey for
 * anything else. Forty modules declare `integration`, so the largest group in
 * the catalogue was the one the panel had no colour for, and a module that
 * invents a category of its own could never have one.
 *
 * It also put core in the position of naming `gaming`, which is a sector this
 * product does not take a position on: it runs a community, a shop, a
 * catalogue, and a game server is one of the things a module can add.
 *
 * A tone is derived from the name instead. Any category gets a stable one,
 * the five that existed keep getting a colour, and none of them is written
 * down here.
 */

const ROOT = join(__dirname, "..", "..");

describe("core knows no category", () => {
    it("names no category in the panel", () => {
        const src = stripComments(fs.readFileSync(
            join(ROOT, "src/app/[locale]/(admin)/admin/modules/module-display.ts"),
            "utf8",
        ));
        for (const named of ["commerce", "community", "management", "gaming", "content", "integration"]) {
            expect(src, `the panel names "${named}"`).not.toMatch(new RegExp(`\\b${named}\\b`));
        }
    });

    it("gives every category a tone, the same one every time", () => {
        const seen = new Set<string>();
        for (const category of ["commerce", "integration", "gaming", "whatever-a-module-invents"]) {
            const tone = categoryTone(category);
            expect(tone).toBe(categoryTone(category));
            seen.add(tone);
        }
        expect(seen.size).toBeGreaterThan(1);
    });
});
