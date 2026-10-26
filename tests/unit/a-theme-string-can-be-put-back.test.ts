/**
 * A theme's words are shipped words, and the translation editor can put one
 * back after an operator changed it.
 *
 * `shippedValue` answered for core and for modules only. A theme's row, which
 * the editor lists beside every other, then had no origin: an edit was
 * measured against the row it replaced instead of what the theme ships, and
 * "restore" refused with "nothing to restore to".
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { shippedValue } from "@/core/lib/i18n/shipped-value";

const KITE = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/themes/kite/theme.json"), "utf8"));

describe("a theme's shipped words", () => {
    it("are what the theme's manifest says, in each language", () => {
        expect(KITE.translations.tr.kite.heroTitle).toBeTruthy();
        expect(shippedValue("theme:kite", "tr", "kite", "heroTitle")).toBe(KITE.translations.tr.kite.heroTitle);
        expect(shippedValue("theme:kite", "en", "kite", "heroTitle")).toBe(KITE.translations.en.kite.heroTitle);
    });

    it("are nothing for a theme the site does not have or a key it does not ship", () => {
        expect(shippedValue("theme:nowhere", "tr", "kite", "heroTitle")).toBeNull();
        expect(shippedValue("theme:kite", "tr", "kite", "noSuchWords")).toBeNull();
    });
});
