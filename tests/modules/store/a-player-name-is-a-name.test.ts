// @vitest-environment node
/**
 * The name a purchase is delivered to goes into a console command, so the
 * till takes only a name in the shape a game name has. A space would add an
 * argument ("Steve 999999" in "eco give {player} 100"), and a character the
 * delivery strips would make it somebody else's ("St@eve" is Steve).
 */
import { describe, it, expect } from "vitest";
import { isPlayerName } from "@/modules/store/lib/player-name";

describe("a player name at the till", () => {
    it("is a game name: letters a to z, digits, _ . and -", () => {
        for (const name of ["Notch", "Steve_2", ".Brock", "jeb-", "a"]) expect(isPlayerName(name)).toBe(true);
    });

    it("is never a name with a space, a selector, a separator or a stray character", () => {
        for (const name of ["Steve 999999", "@a", "evil;op", "St@eve", "", "x".repeat(51), "Çağrı", "a\nb"]) {
            expect(isPlayerName(name)).toBe(false);
        }
    });
});
