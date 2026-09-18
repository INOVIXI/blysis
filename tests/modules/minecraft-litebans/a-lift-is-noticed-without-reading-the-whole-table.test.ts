import { describe, expect, it } from "vitest";
import { punishmentQuery } from "@/modules/minecraft-litebans/lib/query";

/**
 * Two things change on the other server and they are found differently.
 *
 * A new punishment always has a higher id than the last one read, so the
 * cursor finds it. A lift does not: it flips `active` on a row that was read
 * long ago and leaves the id alone, so a cursor walks straight past it.
 *
 * Re-reading everything every five minutes to catch that is somebody else's
 * database being asked to scan its whole ban table all day. A trailing window
 * behind the cursor catches a lift of anything recent and is bounded, and the
 * screen carries a full re-read for the rest.
 */
describe("finding a lift costs a window, not a table scan", () => {
    const base = { table: "litebans_bans", columns: ["id", "uuid", "until", "active"], dialect: "mysql" as const, batch: 100 };

    it("asks only for rows past the cursor when looking for new punishments", () => {
        const built = punishmentQuery({ ...base, scope: "new", cursor: 500 });

        expect("text" in built && built.text).toContain("> ?");
        expect("values" in built && built.values).toContain(500);
    });

    it("bounds the search for lifts at both ends", () => {
        const built = punishmentQuery({ ...base, scope: "lifted", cursor: 5000, window: 2000 });

        // Everything between the bottom of the window and the cursor, and
        // nothing older.
        expect("values" in built && built.values).toEqual(expect.arrayContaining([5000, 3000]));
    });

    it("always carries a limit, whatever it is asked for", () => {
        for (const scope of ["new", "lifted"] as const) {
            const built = punishmentQuery({ ...base, scope, cursor: 1, window: 10 });
            expect("text" in built && built.text).toContain("LIMIT");
        }
    });

    it("reads new punishments oldest first, so a run that stops leaves a usable cursor", () => {
        const built = punishmentQuery({ ...base, scope: "new", cursor: 0 });

        expect("text" in built && built.text).toContain("ORDER BY `id` ASC");
    });
});
