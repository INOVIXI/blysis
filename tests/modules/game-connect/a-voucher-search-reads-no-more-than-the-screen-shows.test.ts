// @vitest-environment node
/**
 * A voucher's id is the voucher. An admin finds one by the end the list
 * shows, and a longer search must not answer whether an id goes on that way.
 */
import { describe, it, expect } from "vitest";
import { HINT, hintOf, voucherSearch } from "@/modules/game-connect/lib/voucher-search";

describe("a voucher search", () => {
    it("matches the end of an id the list shows", () => {
        expect(hintOf("gv_abcdefghijkl")).toBe("ghijkl");
        expect(voucherSearch("ijkl", [])).toEqual({
            OR: [{ id: { endsWith: "ijkl" } }, { createdById: { in: [] } }, { redeemedById: { in: [] } }],
        });
    });

    it("never matches more of an id than the list shows", () => {
        const longer = "x".repeat(HINT + 1);

        expect(JSON.stringify(voucherSearch(longer, ["u1"]))).not.toContain("endsWith");
        expect(voucherSearch(longer, ["u1"])).toEqual({
            OR: [{ createdById: { in: ["u1"] } }, { redeemedById: { in: ["u1"] } }],
        });
    });

    it("finds everything when nothing is typed", () => {
        expect(voucherSearch("", [])).toEqual({});
    });
});
