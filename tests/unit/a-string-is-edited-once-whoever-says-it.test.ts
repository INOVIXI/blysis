// @vitest-environment node
/**
 * One string is one line in the translation editor, whoever ships it.
 *
 * `store.title` is shipped by the store and reworded by the theme being worn,
 * and the editor used to list it twice, once per row, beside every inactive
 * theme's wording of it too. An operator who edited the store's line saw the
 * site keep saying the theme's words, and one who edited the theme's line
 * lost the edit the day the theme changed.
 *
 * A line now says what the site says and who says it, and an edit is filed on
 * the source that owns the string: it outlives a change of theme, and a
 * site's edit is heard over every shipped row, the theme's included.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/core/lib/i18n/shipped-value", () => ({
    shippedValue: (source: string, locale: string, _namespace: string, key: string) => {
        const shipped: Record<string, string> = {
            "store tr title": "Mağaza",
            "theme:kite tr title": "Pazar yeri",
            "store en title": "Store",
        };
        return shipped[`${source} ${locale} ${key}`] ?? null;
    },
}));

import { editOps, lineOf } from "@/core/lib/i18n/translation-lines";

const REF = { namespace: "store", key: "title" };
let ids = 0;
const row = (module: string, locale: string, value: string, isCustom = false) =>
    ({ id: `r${++ids}`, module, locale, value, isCustom, ...REF });

describe("a line of the editor", () => {
    it("says what the site says, who says it, and what it says without the site's edit", () => {
        const line = lineOf(REF, [
            row("store", "tr", "Mağaza"),
            row("theme:kite", "tr", "Pazar yeri"),
            row("store", "en", "Store"),
        ], ["en", "tr", "de"]);
        expect(line.owner).toBe("store");
        expect(line.sources).toEqual(["store", "theme:kite"]);
        expect(line.locales.tr).toEqual({ value: "Pazar yeri", from: "theme:kite", isCustom: false, shipped: "Pazar yeri", review: null, awaiting: false });
        expect(line.locales.en).toEqual({ value: "Store", from: "store", isCustom: false, shipped: "Store", review: null, awaiting: false });
        expect(line.locales.de).toEqual({ value: null, from: null, isCustom: false, shipped: null, review: null, awaiting: false });
    });

    it("hears the site's edit over the theme, and keeps the theme's words beneath it", () => {
        const line = lineOf(REF, [row("store", "tr", "Market", true), row("theme:kite", "tr", "Pazar yeri")], ["tr"]);
        expect(line.locales.tr).toEqual({ value: "Market", from: "store", isCustom: true, shipped: "Pazar yeri", review: null, awaiting: false });
    });

    it("reads an edit filed on the theme's row, as the editor used to file them", () => {
        const line = lineOf(REF, [row("store", "tr", "Mağaza"), row("theme:kite", "tr", "Çarşı", true)], ["tr"]);
        expect(line.locales.tr).toEqual({ value: "Çarşı", from: "theme:kite", isCustom: true, shipped: "Pazar yeri", review: null, awaiting: false });
    });
});

describe("an edit", () => {
    it("is filed on the owner, and an older edit over it goes back to what its source ships", () => {
        const kite = row("theme:kite", "tr", "Çarşı", true);
        const ops = editOps(REF, "store", [row("store", "tr", "Mağaza"), kite], "tr", "Market");
        expect(ops).toEqual([
            { upsert: { locale: "tr", module: "store", value: "Market", basis: "Mağaza" } },
            { restore: { id: kite.id, value: "Pazar yeri" } },
        ]);
    });

    it("drops an older edit whose source ships nothing to go back to", () => {
        const stray = row("theme:kite", "en", "Shop", true);
        const ops = editOps(REF, "store", [row("store", "en", "Store"), stray], "en", "Market");
        expect(ops).toEqual([
            { upsert: { locale: "en", module: "store", value: "Market", basis: "Store" } },
            { drop: { id: stray.id } },
        ]);
    });

    it("leaves other languages and shipped rows alone", () => {
        const ops = editOps(REF, "store", [row("theme:kite", "tr", "Pazar yeri"), row("store", "en", "Shop", true)], "tr", "Market");
        expect(ops).toEqual([{ upsert: { locale: "tr", module: "store", value: "Market", basis: "Mağaza" } }]);
    });
});
