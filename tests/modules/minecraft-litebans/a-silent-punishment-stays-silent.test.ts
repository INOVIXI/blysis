import { describe, expect, it } from "vitest";
import { toReport } from "@/modules/minecraft-litebans/lib/row";

/**
 * A silent punishment is one the staff asked not to be announced.
 *
 * LiteBans marks it so the ban message goes to staff and not to the server.
 * Copying it onto a public punishment list publishes exactly the thing that
 * flag exists to withhold, and it would be published by a site the staff
 * never touched.
 */
describe("a punishment marked silent is not copied to a public list", () => {
    it("drops a silent row", () => {
        expect(toReport({ id: 1, uuid: "u", until: 0, active: 1, silent: 1 }, "ban", "P")).toBeNull();
    });

    it("reads the flag as the drivers return it, not only as a number", () => {
        expect(toReport({ id: 1, uuid: "u", until: 0, active: 1, silent: true }, "ban", "P")).toBeNull();
    });

    it("keeps a row that is not silent", () => {
        expect(toReport({ id: 1, uuid: "u", until: 0, active: 1, silent: 0 }, "ban", "P")).not.toBeNull();
    });

    it("keeps a row from a server too old to have the flag at all", () => {
        expect(toReport({ id: 1, uuid: "u", until: 0, active: 1 }, "ban", "P")).not.toBeNull();
    });
});
