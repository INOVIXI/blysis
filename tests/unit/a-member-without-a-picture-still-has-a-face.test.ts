// @vitest-environment node
import { describe, it, expect } from "vitest";
import { memberInitials, avatarTone } from "@/core/lib/member-initials";

/**
 * A member with no picture is most members, and they were drawn as a grey
 * person icon in a coloured circle - the same silhouette for everybody, so a
 * list of twenty members was twenty identical faces.
 *
 * Initials on a colour the name picks, which is what every forum worth
 * copying does: the same person is the same colour on every screen, two
 * people are rarely the same, and the letters say who it is at 24 pixels
 * where a silhouette says nothing.
 */

describe("the letters", () => {
    it("are the first of each word, for a name that has two", () => {
        expect(memberInitials("Ali Faruk")).toBe("AF");
        expect(memberInitials("ada lovelace")).toBe("AL");
    });

    it("are the first letter alone, for a name that is one word", () => {
        expect(memberInitials("UXPLIMA")).toBe("U");
        expect(memberInitials("steve")).toBe("S");
    });

    it("take the first two words and no more", () => {
        expect(memberInitials("Ali Faruk Yilmaz")).toBe("AF");
    });

    it("ignore the spacing somebody typed", () => {
        expect(memberInitials("  Ali   Faruk  ")).toBe("AF");
    });

    it("answer something for a name that is not letters", () => {
        // A username may be anything the rules allowed. Whatever comes back
        // has to fit the circle, so it is at most two characters and never
        // empty - an empty avatar is a hole in a list.
        for (const odd of ["___", "42", "🙂", "", "  "]) {
            const initials = memberInitials(odd);
            expect(initials.length).toBeGreaterThan(0);
            expect(initials.length).toBeLessThanOrEqual(2);
        }
    });
});

describe("the colour", () => {
    it("is the same every time for the same name", () => {
        expect(avatarTone("uxwadmin")).toBe(avatarTone("uxwadmin"));
    });

    it("does not change when the name is typed in another case", () => {
        // The same person appears as `Steve` in one list and `steve` in
        // another; two colours for one member is worse than no colour.
        expect(avatarTone("Steve")).toBe(avatarTone("steve"));
    });

    it("spreads names across the palette rather than crowding one colour", () => {
        const names = ["ada", "steve", "ayse", "mehmet", "uxwadmin", "kim", "lena", "omar", "yuki", "sara"];
        const tones = new Set(names.map(avatarTone));
        expect(tones.size).toBeGreaterThan(3);
    });

    it("is a class the theme already owns, not a colour written here", () => {
        // A palette hardcoded in a component is a palette that stops matching
        // the moment somebody changes the theme.
        expect(avatarTone("ada")).toMatch(/^bg-/);
        expect(avatarTone("ada")).toMatch(/var\(--color-/);
        expect(avatarTone("ada")).not.toMatch(/#[0-9a-f]{3,6}/i);
    });
});
