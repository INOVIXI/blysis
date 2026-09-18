import { describe, expect, it } from "vitest";
import { toReport } from "@/modules/minecraft-litebans/lib/row";
import { wantedColumns } from "@/modules/minecraft-litebans/lib/query";

/**
 * Who lifted a punishment, and why.
 *
 * `litebans.api.Entry` ships unobfuscated inside the plugin, and its fields
 * are the proof these exist: `removedByUUID`, `removedByName`,
 * `removalReason`. Without them an unbanned member's record says only that the
 * ban stopped, which reads like it expired.
 *
 * There is no removal *timestamp* among those fields, which is why a lift is
 * still found by re-reading a window behind the cursor rather than by asking
 * for everything removed since the last run.
 */
describe("a lifted punishment says who lifted it", () => {
    const base = { id: 7, uuid: "u", until: 0, active: 0 };

    it("carries the staff member's name", () => {
        const report = toReport({ ...base, removed_by_name: "Aeryn" }, "ban", "Player");

        expect(report?.liftedBy).toBe("Aeryn");
    });

    it("carries the reason they gave", () => {
        const report = toReport({ ...base, removed_by_reason: "wrong player" }, "ban", "Player");

        expect(report?.liftReason).toBe("wrong player");
    });

    it("leaves them empty on a punishment nobody has lifted", () => {
        const report = toReport({ ...base, active: 1 }, "ban", "Player");

        expect(report?.liftedBy).toBeNull();
        expect(report?.liftReason).toBeNull();
    });

    it("leaves them empty on a server too old to have the columns", () => {
        const report = toReport(base, "ban", "Player");

        expect(report?.liftedBy).toBeNull();
        expect(report?.liftReason).toBeNull();
    });

    it("asks for the columns when the server has them", () => {
        const columns = wantedColumns(["id", "until", "uuid", "active", "removed_by_name", "removed_by_reason"]);

        expect(columns).toContain("removed_by_name");
        expect(columns).toContain("removed_by_reason");
    });

    it("still reads a server that has neither, because the read is what the server admits to", () => {
        const columns = wantedColumns(["id", "until", "uuid", "active"]);

        expect(columns).not.toBeNull();
        expect(columns).not.toContain("removed_by_name");
    });
});
