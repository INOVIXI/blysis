// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRowList } from "@/core/hooks/useRowList";

/**
 * Searching, paging and picking a list, written once.
 *
 * Measured across the panel on 2026-09-19: 156 admin screens, 67 of them
 * showing a list, three with a box to search it and one with any way to pick
 * rows. Fifteen of the 67 are drawn by the crud shell and gained both at
 * once; the rest are hand-written tables with their own columns and their own
 * row actions, and a shell that owned the markup would have to own all of
 * that too.
 *
 * So this owns the behaviour and not the markup. A screen keeps its table and
 * asks for the three things every one of those tables needs: what the reader
 * typed, which page they are on, and which rows they have picked.
 *
 * The three have to agree with each other, which is the part each screen got
 * wrong on its own:
 *
 *   - searching has to return the reader to the first page, or a term that
 *     matches two rows shows an empty page seven;
 *   - the selection has to be narrowed to the rows on screen, or a bulk
 *     delete counts rows a filter has hidden - the destructive button says
 *     "Delete 8" with three rows in front of the operator;
 *   - the header checkbox has to say "some" while some are unticked, or its
 *     next click clears a selection the reader was building.
 */

const ROWS = [
    { id: "a", name: "Aeryn", email: "aeryn@example.com" },
    { id: "b", name: "Bolt", email: "bolt@example.com" },
    { id: "c", name: "Cinder", email: "cinder@example.com" },
    { id: "d", name: "Dara", email: "dara@example.com" },
];

const text = (row: (typeof ROWS)[number]) => [row.name, row.email];

describe("a list on any screen", () => {
    it("shows everything it was given until somebody types", () => {
        const { result } = renderHook(() => useRowList(ROWS, { text }));
        expect(result.current.rows).toHaveLength(4);
        expect(result.current.total).toBe(4);
    });

    it("keeps the rows that match, whichever line they match on", () => {
        const { result } = renderHook(() => useRowList(ROWS, { text }));
        act(() => result.current.setSearch("cinder@"));
        expect(result.current.rows.map((r) => r.id)).toEqual(["c"]);
    });

    it("ignores case and the space either side of the term", () => {
        const { result } = renderHook(() => useRowList(ROWS, { text }));
        act(() => result.current.setSearch("  BOLT "));
        expect(result.current.rows.map((r) => r.id)).toEqual(["b"]);
    });

    it("pages what is left, not what it started with", () => {
        const { result } = renderHook(() => useRowList(ROWS, { text, pageSize: 2 }));
        expect(result.current.pages).toBe(2);
        act(() => result.current.setSearch("example.com"));
        expect(result.current.pages).toBe(2);
        act(() => result.current.setSearch("aeryn"));
        expect(result.current.pages).toBe(1);
    });

    it("returns the reader to the first page when they search", () => {
        const { result } = renderHook(() => useRowList(ROWS, { text, pageSize: 2 }));
        act(() => result.current.setPage(2));
        expect(result.current.page).toBe(2);
        act(() => result.current.setSearch("e"));
        expect(result.current.page).toBe(1);
    });

    it("picks a row and lets go of it", () => {
        const { result } = renderHook(() => useRowList(ROWS, { text }));
        act(() => result.current.toggle("a"));
        expect([...result.current.picked]).toEqual(["a"]);
        act(() => result.current.toggle("a"));
        expect([...result.current.picked]).toEqual([]);
    });

    it("picks every row on the page, and lets go of every one of them", () => {
        const { result } = renderHook(() => useRowList(ROWS, { text, pageSize: 2 }));
        act(() => result.current.toggleAll());
        expect(result.current.picked.size).toBe(2);
        expect(result.current.headerState).toBe("all");
        act(() => result.current.toggleAll());
        expect(result.current.picked.size).toBe(0);
    });

    it("says some are picked while some are not, so the next click does not clear them", () => {
        const { result } = renderHook(() => useRowList(ROWS, { text, pageSize: 2 }));
        act(() => result.current.toggle("a"));
        expect(result.current.headerState).toBe("some");
    });

    it("forgets a row a search has hidden, so a bulk action counts what is on screen", () => {
        const { result } = renderHook(() => useRowList(ROWS, { text }));
        act(() => result.current.toggle("a"));
        act(() => result.current.toggle("b"));
        expect(result.current.picked.size).toBe(2);
        act(() => result.current.setSearch("aeryn"));
        expect([...result.current.picked]).toEqual(["a"]);
    });

    it("forgets a row that has left the list entirely", () => {
        const { result, rerender } = renderHook(({ rows }) => useRowList(rows, { text }), {
            initialProps: { rows: ROWS },
        });
        act(() => result.current.toggle("d"));
        rerender({ rows: ROWS.slice(0, 3) });
        expect(result.current.picked.size).toBe(0);
    });

    it("clears the selection when it is asked to", () => {
        const { result } = renderHook(() => useRowList(ROWS, { text }));
        act(() => result.current.toggle("a"));
        act(() => result.current.clear());
        expect(result.current.picked.size).toBe(0);
    });

    it("reads a row's text through whatever the screen says is on it", () => {
        // The lines a row draws, not every field it carries: a row found for
        // a reason the screen does not show reads as the search being broken.
        const { result } = renderHook(() => useRowList(ROWS, { text: (row) => [row.name] }));
        act(() => result.current.setSearch("example.com"));
        expect(result.current.rows).toHaveLength(0);
    });
});
