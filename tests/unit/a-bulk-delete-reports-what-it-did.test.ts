import { describe, it, expect, vi } from "vitest";
import { deleteEach } from "@/core/lib/bulk-delete";

/**
 * A bulk delete says what it actually did.
 *
 * There is no endpoint that takes a list of ids, so deleting several rows is
 * several requests - and every answer used to be thrown away. Five rows
 * ticked, four refused by a foreign key, and the panel said "Deleted" and
 * refetched: the operator saw four rows still there and no reason why.
 *
 * Three outcomes, not two. All of them went, none of them went, or some did -
 * and the third is the one worth naming, because it is the only one where the
 * screen and the operator's expectation part company.
 *
 * The loop is sequential on purpose. These are deletes against one database;
 * firing twenty at once buys nothing an operator can perceive and makes the
 * partial case harder to report honestly.
 */

describe("deleting several rows", () => {
    it("reports every one when every one went", async () => {
        const result = await deleteEach(["a", "b"], async () => true);
        expect(result).toEqual({ deleted: 2, total: 2 });
    });

    it("reports none when none went", async () => {
        const result = await deleteEach(["a", "b"], async () => false);
        expect(result).toEqual({ deleted: 0, total: 2 });
    });

    it("reports the part that went", async () => {
        const result = await deleteEach(["a", "b", "c"], async (id) => id !== "b");
        expect(result).toEqual({ deleted: 2, total: 3 });
    });

    it("asks once per row, in the order it was given them", async () => {
        const asked: string[] = [];
        await deleteEach(["a", "b", "c"], async (id) => {
            asked.push(id);
            return true;
        });
        expect(asked).toEqual(["a", "b", "c"]);
    });

    it("counts a row that threw as one that did not go", async () => {
        // A dead network is not a deletion, and it must not be reported as
        // one just because nothing returned false.
        const result = await deleteEach(["a", "b"], async (id) => {
            if (id === "a") throw new Error("offline");
            return true;
        });
        expect(result).toEqual({ deleted: 1, total: 2 });
    });

    it("does nothing at all when nothing was ticked", async () => {
        const each = vi.fn(async () => true);
        expect(await deleteEach([], each)).toEqual({ deleted: 0, total: 0 });
        expect(each).not.toHaveBeenCalled();
    });
});
