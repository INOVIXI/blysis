// @vitest-environment jsdom
/**
 * A shelf the shop handed away is still a shelf when nobody draws it.
 *
 * The shop lets a category be a ladder rather than a grid: ranks, plans,
 * tiers, where the question is what the next one up adds. It emits
 * `store.category.shelf` in the grid's place and passes a fallback, so "a
 * site that has turned this on and then removed whatever draws comparisons
 * gets its shelf back rather than an empty page" - the shop's own words.
 *
 * That fallback only ever fired for a module that was not installed. `Slot`
 * reads the registry, which is a static question: is anybody contributing.
 * A module that contributes and then renders nothing is invisible to it. So
 * the module that draws comparisons answered `null` when no table was bound
 * to the shelf, the shop had already given the whole region away, and
 * `/store?category=ranks` - five active products - drew nothing at all.
 *
 * Measured on the running site on 2026-09-21: one comparison table, nine
 * rows, active, `subjectRef` null. The shelf asked for
 * `store.category:<id>`, got 404, and the page was empty above the footer.
 *
 * The module's own comment already promised the right behaviour - a shelf
 * with nothing written about it should look "unfinished to its operator and
 * like an ordinary shelf to everybody else". This is that second half.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => "/en/store",
}));

vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
    usePathname: () => "/en/store",
    useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

// The parts of the shared UI this component draws with. The real barrel
// reaches navigation, which a jsdom run has no server to resolve.
vi.mock("@/core/sdk/ui", () => ({
    Card: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CardContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Waiting: ({ label }: { label?: string }) => <div aria-busy="true">{label}</div>,
    LoadFailed: () => <div>Could not load</div>,
    useSiteCurrency: () => ({ code: "USD", format: (n: number) => `$${n}` }),
}));

// The grid itself is not what is under test here; which of the two things
// the slot decides to draw is.
vi.mock("@/modules/comparison-table/components/ComparisonGrid", () => ({
    ComparisonGrid: ({ table }: { table: { columns: { label: string }[] } }) => (
        <div>{table.columns.map((column) => <span key={column.label}>{column.label}</span>)}</div>
    ),
}));

const { default: ShelfTable } = await import("@/modules/comparison-table/slots/ShelfTable");

const messages = {
    comparisonTable: { title: "Compare", unstatedNote: "Blank means not stated." },
    common: { loading: "Waiting", retry: "Try again", loadFailed: "Could not load" },
};

const draw = (props: { subjectRef?: string; fallback?: React.ReactNode }) =>
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <ShelfTable {...props} />
        </NextIntlClientProvider>,
    );

const SHELF = "store.category:cat-1";
const answer = (status: number, body: unknown) =>
    vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
    vi.stubGlobal("fetch", answer(200, { table: null }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("a shelf drawn as a comparison", () => {
    it("draws the shop's own shelf when no table is bound to it", async () => {
        vi.stubGlobal("fetch", answer(404, {}));
        draw({ subjectRef: SHELF, fallback: <p>Five ranks</p> });
        await waitFor(() => expect(screen.getByText("Five ranks")).toBeTruthy());
    });

    it("does the same when a table comes back with no columns", async () => {
        // A table somebody started and never filled in is the same answer to
        // a shopper as no table: there is nothing to compare.
        vi.stubGlobal("fetch", answer(200, { table: { columns: [], groups: [] } }));
        draw({ subjectRef: SHELF, fallback: <p>Five ranks</p> });
        await waitFor(() => expect(screen.getByText("Five ranks")).toBeTruthy());
    });

    it("does the same when the shop names no shelf at all", async () => {
        draw({ fallback: <p>Five ranks</p> });
        await waitFor(() => expect(screen.getByText("Five ranks")).toBeTruthy());
    });

    it("draws nothing rather than the shelf twice when there is a table", async () => {
        vi.stubGlobal("fetch", answer(200, {
            table: {
                columns: [{ id: "c1", label: "VIP", subtitle: null, highlight: false }],
                groups: [{ id: "g1", label: "Perks", rows: [{ id: "r1", label: "Fly", cells: {} }] }],
            },
        }));
        draw({ subjectRef: SHELF, fallback: <p>Five ranks</p> });
        await waitFor(() => expect(screen.getByText("VIP")).toBeTruthy());
        expect(screen.queryByText("Five ranks")).toBeNull();
    });

    it("says a read failed rather than quietly drawing the shelf", async () => {
        // A failure is a different answer from an absence. Falling back here
        // would hide a broken endpoint behind a page that looks fine.
        vi.stubGlobal("fetch", answer(500, {}));
        draw({ subjectRef: SHELF, fallback: <p>Five ranks</p> });
        await waitFor(() => expect(screen.queryByText("Five ranks")).toBeNull());
    });
});
