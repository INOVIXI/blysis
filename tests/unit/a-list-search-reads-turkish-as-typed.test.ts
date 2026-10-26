/**
 * A list's search box finds "Altın" for a reader who types "altin" or "ALTIN".
 *
 * The shop, the forum and the help centre narrowed their lists with Prisma's
 * case-insensitive `contains`, which is Postgres `ILIKE`: the dotless ı is a
 * letter of its own there and an upper-case I folds to the dotted i, so a
 * Turkish reader typing without the letter, or in capitals, was told the shop
 * sold no gold. `textContains` asks for every spelling of what was typed.
 *
 * A first attempt read the matching ids in SQL and handed them back to Prisma
 * as a list. A term found in more rows than Postgres takes parameters, which
 * the activity feed reaches by growing, made the list answer with an error.
 */
import { describe, it, expect } from "vitest";
import { searchSpellings, textContains } from "@/core/lib/search-text";

describe("a list search", () => {
    it("tries the dotted and the dotless i wherever one was typed", () => {
        expect(searchSpellings("ALTIN").sort()).toEqual(["ALTiN", "ALTıN"].sort());
        expect(searchSpellings("altın").sort()).toEqual(["altin", "altın"].sort());
        expect(searchSpellings("İzmir").sort()).toEqual(["izmir", "ızmir", "izmır", "ızmır"].sort());
    });

    it("asks for what was typed, once, when it has no i in it", () => {
        expect(searchSpellings("  sword ")).toEqual(["sword"]);
        expect(searchSpellings("   ")).toEqual([]);
    });

    it("stays a handful of spellings however many i a sentence has", () => {
        const spellings = searchSpellings("iiiiiiiiiiii");
        expect(spellings.length).toBeLessThanOrEqual(64);
        expect(spellings).toContain("ııııııiiiiii");
    });

    it("asks every field for every spelling, case ignored", () => {
        expect(textContains(["name", "description"], "altın")).toEqual([
            { name: { contains: "altin", mode: "insensitive" } },
            { name: { contains: "altın", mode: "insensitive" } },
            { description: { contains: "altin", mode: "insensitive" } },
            { description: { contains: "altın", mode: "insensitive" } },
        ]);
    });
});
