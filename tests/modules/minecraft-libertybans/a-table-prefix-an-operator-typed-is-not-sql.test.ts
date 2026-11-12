import { describe, expect, it } from "vitest";
import { historyQuery, safeIdentifier } from "@/modules/minecraft-libertybans/lib/query";

/**
 * LibertyBans lets a server rename its tables, so the prefix is a setting, so an
 * operator types part of a table name and it is concatenated into a query: SQL
 * will not bind an identifier, only a value. A name is refused unless it is a
 * name, rather than escaped into one.
 */
describe("a prefix an operator typed cannot become SQL", () => {
    it("refuses a prefix carrying a quote, a backtick, a space or a semicolon", () => {
        expect(safeIdentifier('libertybans_"; DROP TABLE users; --', "mysql")).toBeNull();
        expect(safeIdentifier("libertybans_`", "mysql")).toBeNull();
        expect(safeIdentifier("liberty bans_names", "postgres")).toBeNull();
        expect(safeIdentifier("libertybans_names;", "postgres")).toBeNull();
    });

    it("accepts an ordinary prefix and quotes it for the dialect it is going to", () => {
        expect(safeIdentifier("libertybans_names", "mysql")).toBe("`libertybans_names`");
        expect(safeIdentifier("libertybans_names", "postgres")).toBe('"libertybans_names"');
    });

    it("refuses to build a query at all when the prefix is not a name", () => {
        const built = historyQuery({
            prefix: "x; DELETE FROM users; --",
            columns: ["id", "type"],
            dialect: "mysql",
            scope: "new",
            batch: 100,
            now: 0,
        });

        expect(built).toEqual({ refuse: "bad-identifier" });
    });

    it("binds every number it is given rather than writing it into the text", () => {
        const built = historyQuery({
            prefix: "libertybans_",
            columns: ["id", "type"],
            dialect: "postgres",
            scope: "lifted",
            batch: 50,
            cursor: 900,
            window: 100,
            now: 1_800_000_000,
        });

        expect(built).toMatchObject({ values: [900, 800, 1_800_000_000, 50] });
        expect("text" in built ? built.text : "").not.toContain("900");
    });

    it("asks all three tables a punishment can stand in, so a standing warning is not read as lifted", () => {
        const built = historyQuery({
            prefix: "libertybans_",
            columns: ["id", "type"],
            dialect: "mysql",
            scope: "new",
            batch: 50,
            now: 0,
        });
        const text = "text" in built ? built.text : "";

        for (const table of ["bans", "mutes", "warns"]) {
            expect(text).toContain(`EXISTS (SELECT 1 FROM \`libertybans_${table}\` WHERE`);
        }
    });
});
