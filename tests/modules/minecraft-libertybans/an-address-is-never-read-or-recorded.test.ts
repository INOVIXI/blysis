import { describe, expect, it } from "vitest";
import { historyQuery, wantedColumns } from "@/modules/minecraft-libertybans/lib/query";
import { toReport } from "@/modules/minecraft-libertybans/lib/row";
import { uuidBytes } from "@/modules/minecraft-libertybans/lib/uuid";

/**
 * LibertyBans can punish an IP address, and its history view carries the
 * address of every punished player beside their UUID. None of that belongs on a
 * website: the address is never selected, and a punishment against an address
 * alone is not copied, because there is no player to name and the only thing
 * left to show is the address.
 *
 * A composite punishment, a player and their address together, is the
 * player's, and is recorded against them.
 */

const HISTORY = ["id", "type", "victim_type", "victim_uuid", "victim_address", "operator", "reason", "scope", "start", "end", "track", "scope_type"];
const PLAYER = "b50ad385-829d-3141-a216-7e7d7539ba7f";

describe("an address is never read or recorded", () => {
    it("does not select the address even though the view has it", () => {
        const columns = wantedColumns(HISTORY);

        expect(columns).not.toBeNull();
        expect(columns).not.toContain("victim_address");
    });

    it("leaves the address out of the query it sends", () => {
        const built = historyQuery({
            prefix: "libertybans_",
            columns: wantedColumns(HISTORY) ?? [],
            dialect: "mysql",
            scope: "new",
            batch: 100,
            now: 0,
        });

        expect("text" in built && built.text).toBeTruthy();
        expect("text" in built ? built.text : "").not.toContain("victim_address");
    });

    it("skips a punishment against an address alone", () => {
        const report = toReport(
            { id: 1, type: 0, victim_type: 1, victim_uuid: Buffer.alloc(16), start: 0, end: 0, in_force: 1 },
            new Map(),
            0,
        );

        expect(report).toBeNull();
    });

    it("records a composite punishment against its player", () => {
        const report = toReport(
            { id: 2, type: 0, victim_type: 2, victim_uuid: uuidBytes(PLAYER), start: 0, end: 0, in_force: 1 },
            new Map([[PLAYER, "Notch"]]),
            0,
        );

        expect(report?.playerName).toBe("Notch");
    });

    it("refuses a view too old to say who a punishment is against", () => {
        expect(wantedColumns(["id", "type", "start", "end"])).toBeNull();
    });
});
