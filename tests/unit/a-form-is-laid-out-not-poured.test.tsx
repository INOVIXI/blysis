// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { formSections, type Laid } from "@/core/lib/form-rows";

/**
 * A form is laid out, not poured.
 *
 * Every screen the crud shell draws handed its fields to one two-column grid
 * and let auto-placement decide what sat beside what. Two things followed,
 * and both are on screens an operator uses every day.
 *
 * A field that needs the full width cannot fit beside a half-width one, so
 * the browser pushes it to the next row and leaves the cell it skipped empty.
 * On the new-announcement screen that is the gap to the right of Title, which
 * is the first thing a reader sees and reads as something missing.
 *
 * And a switch has no height of its own, so it was stretched to its
 * neighbour's and pushed to the bottom of the cell. On the game servers
 * screen that put "Default server" level with the RCON password's input
 * rather than its label, looking like a property of it, while the other
 * switch sat alone on the next row at a different height. Two switches, two
 * positions, neither of them where the reader expects.
 *
 * So the rows are worked out before anything is drawn: a row is one
 * full-width field, or up to two half-width ones, and a switch shares a row
 * only with another switch. A field with nothing beside it takes the width
 * rather than leaving a hole. `group` puts a heading over the ones that
 * belong together, which is what the announcement screen was missing more
 * than it was missing alignment.
 */

interface F {
    key: string;
    type?: string;
    group?: string;
}

const lay = (fields: F[]): Laid<F>[] => formSections(fields, (f) => f.type, (f) => f.group);

const keys = (sections: Laid<F>[]) => sections.map((s) => ({ group: s.group, rows: s.rows.map((r) => r.map((f) => f.key)) }));

describe("the rows a form is drawn in", () => {
    it("pairs plain fields two to a row, in the order they were declared", () => {
        expect(keys(lay([{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }]))).toEqual([
            { group: undefined, rows: [["a", "b"], ["c", "d"]] },
        ]);
    });

    it("gives a field that needs the width a row of its own", () => {
        expect(keys(lay([{ key: "title" }, { key: "body", type: "textarea" }, { key: "type" }]))).toEqual([
            { group: undefined, rows: [["title"], ["body"], ["type"]] },
        ]);
    });

    it("leaves no cell empty: a field with nothing beside it takes the row", () => {
        // This is the hole to the right of Title. A row holding one field is
        // one column wide, so there is nothing to leave empty.
        const sections = lay([{ key: "title" }, { key: "body", type: "textarea" }]);
        expect(sections[0].rows.every((row) => row.length >= 1)).toBe(true);
        expect(sections[0].rows.map((r) => r.length)).toEqual([1, 1]);
    });

    it("puts a switch beside a switch and never beside a box", () => {
        expect(keys(lay([
            { key: "name" },
            { key: "active", type: "toggle" },
            { key: "dismissible", type: "toggle" },
            { key: "port" },
        ]))).toEqual([
            { group: undefined, rows: [["name"], ["active", "dismissible"], ["port"]] },
        ]);
    });

    it("does not pair a lone switch with the box that follows it", () => {
        expect(keys(lay([{ key: "active", type: "toggle" }, { key: "port" }]))).toEqual([
            { group: undefined, rows: [["active"], ["port"]] },
        ]);
    });

    it("starts a new section at a heading, and keeps the fields under it", () => {
        expect(keys(lay([
            { key: "title" },
            { key: "from", group: "When" },
            { key: "to", group: "When" },
            { key: "show", group: "Where" },
            { key: "hide", group: "Where" },
        ]))).toEqual([
            { group: undefined, rows: [["title"]] },
            { group: "When", rows: [["from", "to"]] },
            { group: "Where", rows: [["show", "hide"]] },
        ]);
    });

    it("never carries a row across a heading", () => {
        const sections = lay([{ key: "a" }, { key: "b", group: "Second" }]);
        expect(keys(sections)).toEqual([
            { group: undefined, rows: [["a"]] },
            { group: "Second", rows: [["b"]] },
        ]);
    });

    it("loses nothing and reorders nothing", () => {
        const fields: F[] = [
            { key: "a" }, { key: "b", type: "textarea" }, { key: "c", type: "toggle" },
            { key: "d", group: "g" }, { key: "e", group: "g", type: "image" }, { key: "f", group: "g" },
        ];
        const flat = lay(fields).flatMap((s) => s.rows.flat()).map((f) => f.key);
        expect(flat).toEqual(fields.map((f) => f.key));
    });
});
