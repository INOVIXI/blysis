import { describe, expect, it } from "vitest";
import { punishmentQuery, safeIdentifier } from "@/modules/minecraft-litebans/lib/query";

/**
 * LiteBans lets a server rename its tables, so the prefix is a setting, so an
 * operator types part of a table name and it is concatenated into a query -
 * SQL will not bind an identifier, only a value.
 *
 * The answer is the same one `external-data` reached and for the same reason:
 * a name is refused unless it is a name, rather than escaped into one.
 * Escaping is a thing you can get subtly wrong; refusing is not.
 */
describe("a prefix an operator typed cannot become SQL", () => {
    it("refuses a prefix carrying a quote", () => {
        expect(safeIdentifier('litebans_"; DROP TABLE users; --', "mysql")).toBeNull();
    });

    it("refuses a prefix carrying a backtick", () => {
        expect(safeIdentifier("litebans_`", "mysql")).toBeNull();
    });

    it("refuses a prefix carrying a space or a semicolon", () => {
        expect(safeIdentifier("lite bans_bans", "postgres")).toBeNull();
        expect(safeIdentifier("litebans_bans;", "postgres")).toBeNull();
    });

    it("accepts an ordinary prefix and quotes it for the dialect it is going to", () => {
        expect(safeIdentifier("litebans_bans", "mysql")).toBe("`litebans_bans`");
        expect(safeIdentifier("litebans_bans", "postgres")).toBe('"litebans_bans"');
    });

    it("refuses to build a query at all when the name is not a name", () => {
        const built = punishmentQuery({
            table: "litebans_bans; DELETE FROM users",
            columns: ["id", "uuid"],
            dialect: "mysql",
            scope: "new",
            batch: 100,
        });

        expect(built).toEqual({ refuse: "bad-identifier" });
    });
});
