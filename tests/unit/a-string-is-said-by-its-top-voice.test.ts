/**
 * Which source says a string, worked out once for the site and the editor.
 *
 * The site merges every row in one order, core, then the module that ships
 * the string, then the theme being worn, then anything the site edited. The
 * translation editor has to say the same thing about one string: who is
 * speaking, and where an edit belongs. That is the source that owns the
 * string, the lowest one shipping it, so the edit outlives a change of theme;
 * it is still heard over the theme, since every edit is heard last.
 */
import { describe, it, expect } from "vitest";
import { isVisibleSource, ownerOf, sayingOf, sortByVoice } from "@/core/lib/i18n/translation-layers";

const row = (module: string, value: string, isCustom = false) => ({ module, value, isCustom });

describe("the voice a string is said in", () => {
    it("is the last of core, module, theme and the site's own edit", () => {
        expect(sayingOf([row("core", "Mağaza"), row("theme:kite", "Pazar yeri"), row("store", "Dükkan")])).toEqual({ value: "Pazar yeri", from: "theme:kite", isCustom: false });
        expect(sayingOf([row("theme:kite", "Pazar yeri"), row("store", "Market", true)])).toEqual({ value: "Market", from: "store", isCustom: true });
        expect(sayingOf([])).toBeNull();
    });

    it("puts the site's edits last and, among them, the higher voice last", () => {
        const sorted = sortByVoice([row("theme:kite", "b", true), row("store", "a", true), row("theme:kite", "c"), row("core", "d")]);
        expect(sorted.map((r) => r.value)).toEqual(["d", "c", "a", "b"]);
    });

    it("files an edit on the source that owns the string, under any theme's wording of it", () => {
        expect(ownerOf(["theme:kite", "store"])).toBe("store");
        expect(ownerOf(["store", "core"])).toBe("core");
        expect(ownerOf(["theme:kite"])).toBe("theme:kite");
        expect(ownerOf([])).toBeNull();
    });

    it("hears only the theme being worn", () => {
        expect(isVisibleSource("core", "kite")).toBe(true);
        expect(isVisibleSource("store", "kite")).toBe(true);
        expect(isVisibleSource("theme:kite", "kite")).toBe(true);
        expect(isVisibleSource("theme:quarry", "kite")).toBe(false);
    });
});
