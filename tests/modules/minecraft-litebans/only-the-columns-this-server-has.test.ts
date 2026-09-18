import { describe, expect, it } from "vitest";
import { punishmentQuery, wantedColumns } from "@/modules/minecraft-litebans/lib/query";

/**
 * The schema on the other side is not ours and it moves.
 *
 * LiteBans has added columns over the years - `silent`, `ipban`, `server_scope`
 * - and an operator may be running a version from before any of them. Naming a
 * column the server does not have fails the whole read, so the read asks the
 * server which columns it has and selects the ones both sides know.
 *
 * `SELECT *` would sidestep the question and is the wrong answer: it hands
 * back whatever else that table holds, which on somebody else's database is
 * IP addresses nobody asked to copy.
 */
describe("the read names only columns the other server actually has", () => {
    it("keeps a column both sides know", () => {
        expect(wantedColumns(["id", "uuid", "until", "active", "reason"])).toContain("reason");
    });

    it("drops a column this server has never heard of", () => {
        expect(wantedColumns(["id", "uuid", "until", "active"])).not.toContain("silent");
    });

    it("ignores a column of theirs we did not ask for, so nothing extra is copied", () => {
        expect(wantedColumns(["id", "uuid", "until", "active", "ip"])).not.toContain("ip");
    });

    it("refuses when the server is missing something the record cannot do without", () => {
        // Without an id there is no stable reference, so every read would
        // write the same punishment again under a new one.
        expect(wantedColumns(["uuid", "until", "active"])).toBeNull();
    });

    it("never selects every column", () => {
        const built = punishmentQuery({
            table: "litebans_bans",
            columns: ["id", "uuid", "until", "active"],
            dialect: "mysql",
            scope: "new",
            batch: 100,
        });

        expect("text" in built && built.text).not.toContain("*");
    });
});
