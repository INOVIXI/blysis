import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

/**
 * Two rows of pills, doing two different jobs, looking identical.
 *
 * The punishments list had seven buttons for the kind of punishment and four
 * for the place it happened, stacked one row above the other, drawn with the
 * same outline button. Nothing on the screen said which row was which, and a
 * reader had to click one to find out. The leaderboard drew its boards the
 * same way, so the same control meant "switch what I am looking at" there and
 * "narrow what I am looking at" one page over.
 *
 * They are two jobs and they get two shapes now. Narrowing is the strip every
 * other list a member meets already has - a box and some selects, see
 * `ListControls`. Switching is a tab rail, and this is the file that keeps it
 * a real one: a row of buttons is not a tablist to anybody who cannot see the
 * one that looks pressed.
 *
 * Arrow keys are the part hand-rolled tabs always miss. A tablist that only
 * responds to Tab makes a reader step through every board to reach the last,
 * and then Tab again to leave - which is why the pattern puts the whole rail
 * on one tab stop and moves between tabs with the arrows.
 */

const ROOT = join(__dirname, "../..");
const RAIL = join(ROOT, "src/core/components/ui/segmented-tabs.tsx");

describe("a tab rail is operable by keyboard", () => {
    const source = existsSync(RAIL) ? readFileSync(RAIL, "utf-8") : "";

    it("exists, because the alternative is every page drawing its own", () => {
        expect(source).not.toBe("");
    });

    it("says what it is, so a screen reader announces a tab and not a button", () => {
        expect(source).toContain('role="tablist"');
        expect(source).toContain('role="tab"');
        expect(source).toContain("aria-selected");
    });

    it("moves between tabs with the arrows and off the rail with Tab", () => {
        // One stop for the whole rail: the selected tab is reachable, the
        // rest are not, and the arrows move the selection.
        expect(source).toContain("tabIndex");
        expect(source).toContain("ArrowRight");
        expect(source).toContain("ArrowLeft");
        expect(source).toContain("Home");
        expect(source).toContain("End");
    });

    it("does not say which tab is chosen with colour alone", () => {
        // `aria-selected` is the answer for a reader who cannot see the
        // underline, and the underline is the answer for one who cannot tell
        // the two text colours apart.
        expect(source).toMatch(/aria-selected=\{/);
    });

    it("is what the pages that switch between lists use", () => {
        const users = ["module-sources/leaderboard/components/BoardTabs.tsx",
                       "module-sources/punishments/components/PunishmentList.tsx"];
        for (const path of users) {
            expect(readFileSync(join(ROOT, path), "utf-8"), path).toContain("SegmentedTabs");
        }
    });

    it("is the only thing that draws a tablist", () => {
        /*
         * The first shape of this rule scanned for a mapped row of outline
         * buttons and caught eight screens that are not rails at all: an
         * order status, read or unread, a suggestion's state. Those narrow one
         * list by one dimension with a handful of values, and chips are a
         * better control for that than a select - one click, and the chosen
         * value readable without opening anything. They are a third thing,
         * and they deserve their own shared component; they are not this one
         * drawn badly.
         *
         * What is enforceable is that nobody hand-rolls the pattern this file
         * is about. A second tablist would be a second set of keyboard rules.
         */
        const offenders: string[] = [];
        const walk = (dir: string) => {
            if (!existsSync(dir)) return;
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === "node_modules") continue;
                const full = join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.name.endsWith(".tsx") && full !== RAIL) {
                    if (/role="tablist"/.test(readFileSync(full, "utf-8"))) {
                        offenders.push(full.slice(ROOT.length + 1));
                    }
                }
            }
        };
        walk(join(ROOT, "module-sources"));
        walk(join(ROOT, "src/core/components"));
        walk(join(ROOT, "src/app"));

        expect(offenders).toEqual([]);
    });
});
