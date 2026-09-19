// @vitest-environment jsdom
/**
 * A strip that filters a list by a named kind is one shape.
 *
 * Three screens draw one and all three draw it differently. The moderation
 * queue writes raw `<button>` elements with its own colours, and sets the
 * count in a ten-pixel span pressed straight against the label with no space
 * between them, so "Blog Yorumları14" runs together - and a kind with nothing
 * waiting gets no count at all, so that tab is visibly shorter than the ones
 * beside it. That is what the maintainer saw: broken and out of proportion.
 * The store's orders screen puts its count in brackets and also only when it
 * is not zero, so its tabs jump about as orders arrive. The ticket queue has
 * no counts on its tabs at all and four cards above them that do that job.
 *
 * A count that disappears at zero is worse than one that does not: the tab
 * changes width, and an operator cannot tell "nothing is waiting" from
 * "this screen does not count that".
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { FilterChips } from "@/core/components/admin/FilterChips";

const ROOT = path.resolve(__dirname, "../..");

const CHIPS = [
    { id: "all", label: "All", count: 25 },
    { id: "blog-comment", label: "Blog Comments", count: 14 },
    { id: "forum-topic", label: "Forum Topics", count: 0 },
];

describe("a filter strip", () => {
    it("keeps a space between a name and its count", () => {
        render(<FilterChips chips={CHIPS} active="all" onSelect={() => {}} label="Kind" />);
        const tab = screen.getByRole("button", { name: /Blog Comments/ });
        // Two elements, and a gap between them. jsdom has no layout, so the
        // space cannot be read off the text - `textContent` runs them
        // together whatever the CSS says, which is exactly how the original
        // shipped looking wrong and reading fine.
        expect(within(tab).getByText("Blog Comments")).toBeTruthy();
        expect(within(tab).getByText("14")).toBeTruthy();
        expect(tab.className).toMatch(/\bgap-/);
    });

    it("counts a kind with nothing waiting, rather than dropping the number", () => {
        render(<FilterChips chips={CHIPS} active="all" onSelect={() => {}} label="Kind" />);
        const empty = screen.getByRole("button", { name: /Forum Topics/ });
        expect(within(empty).getByText("0")).toBeTruthy();
    });

    it("says which one is chosen, to a screen reader as well as an eye", () => {
        render(<FilterChips chips={CHIPS} active="blog-comment" onSelect={() => {}} label="Kind" />);
        /*
         * A chip is a toggle, not a tab. `a-tab-rail-is-operable-by-keyboard`
         * drew that line: switching between lists is a tablist and its arrow
         * keys, narrowing one list by one dimension is this, and that file
         * says in so many words that the second one "deserves its own shared
         * component". So `aria-pressed`, and a named group around the row so
         * a reader learns what the chips narrow by before pressing one.
         */
        expect(screen.getByRole("button", { name: /Blog Comments/ }).getAttribute("aria-pressed")).toBe("true");
        expect(screen.getByRole("button", { name: /All/ }).getAttribute("aria-pressed")).toBe("false");
        expect(screen.getByRole("group", { name: "Kind" })).toBeTruthy();
    });

    it("leaves the count out where a tab has none to give", () => {
        render(<FilterChips chips={[{ id: "a", label: "Open" }, { id: "b", label: "Closed" }]} active="a" onSelect={() => {}} label="Status" />);
        expect(screen.getByRole("button", { name: "Open" }).textContent).toBe("Open");
    });
});

describe("the screens that filter by a kind", () => {
    /**
     * A census, so the next one is drawn rather than written again. An entry
     * here is a screen that builds a row of buttons which each narrow the same
     * list; a screen that has one and is not on this list has hand-rolled it.
     */
    const DRAWN = [
        "src/app/[locale]/(admin)/admin/moderation/page.tsx",
        "module-sources/store/pages/admin/orders/page.tsx",
        "module-sources/tickets/pages/admin/tickets/page.tsx",
    ];

    /**
     * Screens that still draw their own, with the ceiling that keeps the list
     * shrinking. Each one narrows a list by one dimension with a handful of
     * values, which is what a chip is for; none of them counts anything yet,
     * which is the other half of what they are missing.
     *
     * Not converted with the three above because each needs its own look
     * afterwards, and a strip that changes on ten screens at once is a strip
     * nobody checked on any of them.
     */
    const NOT_YET = [
        "module-sources/help-center/pages/admin/help/page.tsx",
        "module-sources/in-app-notifications/pages/public/notifications/page.tsx",
        "module-sources/punishments/pages/admin/page.tsx",
        "module-sources/suggestions/components/SuggestionBoard.tsx",
        "module-sources/suggestions/pages/admin/page.tsx",
    ];

    it("all draw the same strip", () => {
        const without = DRAWN.filter((rel) => !fs.readFileSync(path.join(ROOT, rel), "utf8").includes("FilterChips"));
        expect(without).toEqual([]);
    });

    it("has a list of screens still to convert that only gets shorter", () => {
        expect(NOT_YET.length).toBeLessThanOrEqual(5);
        const gone = NOT_YET.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
        expect(gone, "these were converted or removed; drop them from the list").toEqual([]);
        const done = NOT_YET.filter((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").includes("FilterChips"));
        expect(done, "these are on the shared strip now; move them to DRAWN").toEqual([]);
    });

    it("none of them writes its own chip colours", () => {
        // The tell: a button whose background is chosen by whether it is the
        // active one. That decision belongs to the strip.
        const offenders = DRAWN.filter((rel) => {
            const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
            return /\?\s*"bg-primary text-primary-foreground"/.test(src);
        });
        expect(offenders).toEqual([]);
    });
});
