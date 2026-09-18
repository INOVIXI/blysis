import { describe, expect, it } from "vitest";
import { toReport } from "@/modules/minecraft-litebans/lib/row";

/**
 * The punishment tables hold no player name.
 *
 * `id, uuid, reason, banned_by_name, time, until, active` is the whole of what
 * LiteBans selects from a punishment table - the name of the person punished
 * is not among them. It lives in the history table and is looked up by UUID,
 * and that lookup misses for anyone who has not been seen since the table was
 * built. An IP ban has no player at all.
 *
 * Refusing those rows would drop real punishments on the floor. The record
 * takes the UUID as the name instead, which is what the server itself shows
 * when it cannot find one.
 */
describe("a row with no name is still a punishment", () => {
    it("falls back to the UUID when the history table did not answer", () => {
        const report = toReport({ id: 7, uuid: "0b1c-uuid", until: 0, active: 1 }, "ban", null);

        expect(report?.playerName).toBe("0b1c-uuid");
        expect(report?.playerUuid).toBe("0b1c-uuid");
    });

    it("prefers the name when there is one", () => {
        const report = toReport({ id: 7, uuid: "0b1c-uuid", until: 0, active: 1 }, "ban", "Player");

        expect(report?.playerName).toBe("Player");
    });

    it("refuses only when there is neither, because nothing would identify it", () => {
        expect(toReport({ id: 7, until: 0, active: 1 }, "ban", null)).toBeNull();
    });
});
