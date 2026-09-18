import { describe, expect, it } from "vitest";
import { toReport } from "@/modules/minecraft-litebans/lib/row";

/**
 * `active` is a BIT column in MySQL, and the driver hands it back as a number,
 * a Buffer or a boolean depending on the server and the driver's settings.
 * Read carelessly, every one of those is truthy - including the zero that
 * means the ban was lifted - so an unbanned member stays banned on the site
 * for ever.
 */
describe("a punishment the server lifted is recorded as lifted", () => {
    it("reads 0 as lifted", () => {
        expect(toReport({ id: 1, uuid: "u", until: 0, active: 0 }, "ban", "P")?.active).toBe(false);
    });

    it("reads false as lifted", () => {
        expect(toReport({ id: 1, uuid: "u", until: 0, active: false }, "ban", "P")?.active).toBe(false);
    });

    it("reads 1 as standing", () => {
        expect(toReport({ id: 1, uuid: "u", until: 0, active: 1 }, "ban", "P")?.active).toBe(true);
    });

    it("assumes standing when the column was not read", () => {
        expect(toReport({ id: 1, uuid: "u", until: 0 }, "ban", "P")?.active).toBe(true);
    });
});
