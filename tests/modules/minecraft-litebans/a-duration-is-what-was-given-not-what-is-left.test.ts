import { describe, expect, it } from "vitest";
import { toReport } from "@/modules/minecraft-litebans/lib/row";

/**
 * A punishment's duration is how long it was handed down for.
 *
 * LiteBans stores two timestamps: `time`, when it was placed, and `until`,
 * when it ends. The plugin's own `Entry.getDuration()` is the distance between
 * them.
 *
 * Measuring from now instead gives the time remaining, which is a different
 * number that shrinks every minute and is wrong the moment a punishment is
 * read for a second time. A thirty day ban placed three weeks ago would be
 * recorded, and shown to the member it is about, as a seven day ban.
 */
describe("a duration is the sentence, not the time left to serve", () => {
    const DAY = 86_400_000;
    const placed = Date.now() - 20 * DAY;

    it("reads a thirty day ban as thirty days however late it is read", () => {
        const report = toReport(
            { id: 1, uuid: "u", time: placed, until: placed + 30 * DAY, active: 1 },
            "ban",
            "Player",
        );

        expect(report?.duration).toBe("30d");
    });

    it("records when it ends, which is the part that does move", () => {
        const report = toReport(
            { id: 1, uuid: "u", time: placed, until: placed + 30 * DAY, active: 1 },
            "ban",
            "Player",
        );

        expect(report?.expiresAt).toBe(new Date(placed + 30 * DAY).toISOString());
    });

    it("leaves a permanent punishment's duration unsaid rather than saying it in English", () => {
        // The screen prints its own translated word when there is nothing
        // here. A literal "permanent" written into the column reaches a
        // Turkish reader in English.
        const report = toReport({ id: 1, uuid: "u", time: placed, until: 0, active: 1 }, "ban", "Player");

        expect(report?.duration).toBeNull();
        expect(report?.expiresAt).toBeNull();
    });

    it("treats LiteBans' other spelling of forever the same way", () => {
        expect(toReport({ id: 1, uuid: "u", until: -1, active: 1 }, "ban", "Player")?.expiresAt).toBeNull();
    });

    it("calls a ban that ends a tempBan, and one that does not a ban", () => {
        const temporary = toReport({ id: 1, uuid: "u", time: placed, until: placed + DAY, active: 1 }, "ban", "P");
        const forever = toReport({ id: 2, uuid: "u", until: 0, active: 1 }, "ban", "P");

        expect(temporary?.type).toBe("tempBan");
        expect(forever?.type).toBe("ban");
    });

    it("never calls a kick temporary, because a kick does not run for a period", () => {
        const report = toReport({ id: 1, uuid: "u", time: placed, until: placed + DAY, active: 1 }, "kick", "P");

        expect(report?.type).toBe("kick");
    });
});
