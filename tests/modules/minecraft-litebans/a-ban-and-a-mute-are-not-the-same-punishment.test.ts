import { describe, expect, it } from "vitest";
import { toReport } from "@/modules/minecraft-litebans/lib/row";

/**
 * LiteBans numbers each kind of punishment on its own.
 *
 * `Database.getBan(long id, ...)`, `getMute(long id, ...)`, `getWarning` and
 * `getKick` are four separate lookups in the plugin's own API, each taking an
 * id, because the id is only unique inside one table. Ban 42 and mute 42 both
 * exist on any server that has handed out either.
 *
 * The record this site keeps is unique on `(source, externalRef)`, so a
 * reference that is only the number means the second one read overwrites the
 * first: a member's ban silently becomes a mute.
 */
describe("a reference names which kind of punishment it is", () => {
    const row = { id: 42, uuid: "u", banned_by_name: "staff", until: 0, active: 1 };

    it("does not give a ban and a mute the same reference", () => {
        const ban = toReport(row, "ban", "Player");
        const mute = toReport(row, "mute", "Player");

        expect(ban?.externalRef).not.toBe(mute?.externalRef);
    });

    it("keeps the number so a row can still be found on the server", () => {
        expect(toReport(row, "ban", "Player")?.externalRef).toContain("42");
    });

    it("gives the same row the same reference every time, so a re-read updates", () => {
        expect(toReport(row, "ban", "Player")?.externalRef).toBe(toReport(row, "ban", "Player")?.externalRef);
    });
});
