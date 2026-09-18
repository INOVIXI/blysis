import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Four boxes in a row, three of them the same size.
 *
 * The dashboard's KPI cards are a grid, and a grid stretches its items, so
 * this should have been free. It was not, because of one wrapper: the row
 * rendered each core widget as `<div key={id}>{widget}</div>`. The grid
 * stretched the div; the `<Link>` inside it had `block` and no height, so it
 * sized to its content; and the `h-full` on the card underneath resolved
 * against that auto height and did nothing at all.
 *
 * Which only showed when a card had less to say. Users, health and the email
 * queue all draw three lines. Recent errors draws two when there is an error
 * to report - no reassuring "none lately" line under the number - and came
 * out visibly shorter than the three beside it.
 *
 * Two of the four widgets already carried `h-full` and it changed nothing,
 * which is the part worth remembering: the height has to be unbroken from the
 * grid item all the way down, and a single link in the middle with an auto
 * height ends it.
 */

const ROOT = join(__dirname, "../..");
const WIDGETS = join(ROOT, "src/core/components/admin/widgets");
const ROW = join(ROOT, "src/app/[locale]/(admin)/admin/components/dashboard-client.tsx");

/** A widget shaped as a link wrapping a card is one of the row's cards. */
function cardWidgets(): { name: string; source: string }[] {
    return readdirSync(WIDGETS)
        .filter((name) => name.endsWith(".tsx"))
        .map((name) => ({ name, source: readFileSync(join(WIDGETS, name), "utf-8") }))
        .filter(({ source }) => /<Link[^>]*>[\s\S]{0,200}<Card/.test(source));
}

describe("a row of cards is one height", () => {
    const widgets = cardWidgets();

    it("finds the cards it is about", () => {
        // A rule that matches nothing passes for ever.
        expect(widgets.length).toBeGreaterThan(2);
    });

    it("gives the link a height, or the card below it has nothing to fill", () => {
        const flat = widgets
            .filter(({ source }) => !/<Link[^>]*className="[^"]*\bh-full\b/.test(source))
            .map(({ name }) => name);

        expect(flat).toEqual([]);
    });

    it("gives the card one too", () => {
        const flat = widgets
            .filter(({ source }) => !/<Card[^>]*className="[^"]*\bh-full\b/.test(source))
            .map(({ name }) => name);

        expect(flat).toEqual([]);
    });

    it("does not put a bare wrapper between the grid and the widget", () => {
        // `<div key={id}>{widget}</div>` is the shape that broke it, and the
        // div is the thing the grid stretches instead of the card.
        const row = readFileSync(ROW, "utf-8");

        expect(row).not.toMatch(/<div key=\{id\}>\{coreSlots\[id\]\}<\/div>/);
    });
});
