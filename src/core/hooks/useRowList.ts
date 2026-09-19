"use client";

import { useEffect, useMemo, useState } from "react";
import {
    headerState,
    narrowTo,
    pickAll,
    pickNone,
    togglePick,
    type HeaderState,
    type Selection,
} from "@/core/lib/bulk-selection";

/**
 * Searching, paging and picking a list, written once.
 *
 * Measured across the panel on 2026-09-19: 156 admin screens, 67 of them
 * showing a list, three with a box to search it and one with any way to pick
 * rows. Fifteen of the 67 are drawn by the crud shell and gained both at
 * once. The rest are hand-written tables with their own columns and their own
 * row actions, and a shell that owned the markup would have to own all of
 * that as well - which is why nobody wrote one, and why every table grew its
 * own half of the answer or none of it.
 *
 * So this owns the behaviour and leaves the markup alone. A screen keeps its
 * table and asks for the three things all of those tables need.
 *
 * The three have to agree, and that is the part each screen got wrong
 * separately:
 *
 *   - searching returns the reader to the first page, or a term that matches
 *     two rows shows them an empty page seven;
 *   - the selection is narrowed to the rows actually listed, or a bulk delete
 *     counts rows a filter has hidden and the destructive button offers to
 *     delete eight with three in front of the operator;
 *   - the header box says "some" while some are unticked, or its next click
 *     clears a selection the reader was still building.
 *
 * The rows are already in the browser on every screen that uses this, so the
 * search narrows what the screen holds rather than asking the endpoint again.
 * A list too large for that wants a different answer - a query the server
 * runs - and should not reach for this.
 */

export interface RowListOptions<T> {
    /**
     * The lines this screen draws for a row.
     *
     * Not every field the row carries: a row found for a reason the screen
     * does not show reads to the operator as the search being broken.
     */
    text: (row: T) => (string | null | undefined)[];
    /** Rows per page. */
    pageSize?: number;
    /** How a row names itself. Defaults to `row.id`. */
    idOf?: (row: T) => string;
}

export interface RowList<T> {
    /** What is in the search box. */
    search: string;
    setSearch: (term: string) => void;

    /** The rows to draw: searched, then cut to the current page. */
    rows: T[];
    /** How many rows the search left, across every page. */
    total: number;
    page: number;
    pages: number;
    setPage: (page: number) => void;

    /** The ids the reader has picked, never including one they cannot see. */
    picked: Selection;
    toggle: (id: string) => void;
    /** Picks every listed row, or lets go of all of them. */
    toggleAll: () => void;
    headerState: HeaderState;
    clear: () => void;
}

/** What a screen needs to tick rows, whoever is doing the paging. */
export interface RowPicks {
    /** The ids ticked, never including one that is not on screen. */
    picked: Selection;
    toggle: (id: string) => void;
    /** Ticks every row on screen, or lets go of all of them. */
    toggleAll: () => void;
    headerState: HeaderState;
    clear: () => void;
}

/**
 * Ticking rows on a list somebody else pages.
 *
 * A screen whose rows arrive one page at a time from the endpoint - members,
 * gift codes, orders - cannot use `useRowList`: the searching and the paging
 * are the server's. What it still needs is the third part, and the same rule
 * about it. The count on a destructive button is a promise about what is on
 * screen, so a row the next page does not carry is a row the button must stop
 * counting.
 */
export function useRowPicks<T>(rows: readonly T[], idOf?: (row: T) => string): RowPicks {
    const [picked, setPicked] = useState<Selection>(pickNone());
    const listedIds = rows.map((row) => (idOf ? idOf(row) : String((row as { id?: unknown }).id ?? "")));

    // Narrowed during the render rather than in an effect: an effect runs
    // after the paint, and that frame is the one an operator clicks in.
    const narrowed = narrowTo(picked, listedIds);
    if (narrowed !== picked) setPicked(narrowed);

    return {
        picked: narrowed,
        toggle: (id: string) => setPicked((prev) => togglePick(prev, id)),
        toggleAll: () =>
            setPicked((prev) =>
                headerState(prev, listedIds) === "all" ? pickNone() : pickAll(prev, listedIds),
            ),
        headerState: headerState(narrowed, listedIds),
        clear: () => setPicked(pickNone()),
    };
}

export function useRowList<T>(rows: readonly T[], options: RowListOptions<T>): RowList<T> {
    const { text, pageSize = 20, idOf } = options;
    const [search, setSearchTerm] = useState("");
    const [page, setPage] = useState(1);
    const [picked, setPicked] = useState<Selection>(pickNone());

    const found = useMemo(() => {
        const term = search.trim().toLocaleLowerCase();
        if (term === "") return [...rows];
        return rows.filter((row) =>
            text(row).some((line) => (line ?? "").toLocaleLowerCase().includes(term)),
        );
        // `text` is written inline at every call site, so a new function every
        // render; depending on it would rebuild the list on every keystroke of
        // anything else on the screen.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, search]);

    const pages = Math.max(1, Math.ceil(found.length / pageSize));
    const current = Math.min(page, pages);
    const listed = found.slice((current - 1) * pageSize, current * pageSize);
    const listedIds = listed.map((row) => (idOf ? idOf(row) : String((row as { id?: unknown }).id ?? "")));

    // Deleting the last row of the last page must not strand the reader on a
    // page that no longer exists.
    useEffect(() => {
        if (page > pages) setPage(pages);
    }, [page, pages]);

    /*
     * Narrowed during the render rather than in an effect. An effect runs
     * after the paint, so the destructive button would show the old count for
     * one frame - and that is the frame an operator clicks in.
     */
    const narrowed = narrowTo(picked, listedIds);
    if (narrowed !== picked) setPicked(narrowed);

    return {
        search,
        setSearch: (term: string) => {
            setSearchTerm(term);
            // A term that matches two rows has no page seven to show.
            setPage(1);
        },
        rows: listed,
        total: found.length,
        page: current,
        pages,
        setPage,
        picked: narrowed,
        toggle: (id: string) => setPicked((prev) => togglePick(prev, id)),
        toggleAll: () =>
            setPicked((prev) =>
                headerState(prev, listedIds) === "all" ? pickNone() : pickAll(prev, listedIds),
            ),
        headerState: headerState(narrowed, listedIds),
        clear: () => setPicked(pickNone()),
    };
}
