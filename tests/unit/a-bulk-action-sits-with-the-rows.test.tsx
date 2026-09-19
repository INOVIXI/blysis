// @vitest-environment jsdom
/**
 * The action that touches the ticked rows sits with them.
 *
 * The crud shell put its destructive button in the page header, beside "Add
 * new" - so an operator ticked three rows halfway down a table and the button
 * that would delete them was at the top of the screen, next to the one that
 * makes another. On a full page the button and the rows it names are not
 * visible at the same time.
 *
 * It belongs in the strip above the rows, which already exists to hold the
 * select-all box. That strip says one of two things: how to tick the page, or
 * how many are ticked and what can be done to them. Nothing else on the screen
 * changes meaning when a row is ticked, so nothing else should move.
 *
 * The count is a promise about what is on screen - see
 * `a-bulk-action-names-the-rows-it-will-touch.test.ts` for the arithmetic
 * behind it. What this file adds is that the promise is visible next to the
 * rows it is about, and that the page header keeps only the screen's own
 * primary action.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {}, replace: () => {} }),
    usePathname: () => "/admin/downloads",
    useSearchParams: () => new URLSearchParams(),
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const ROWS = [
    { id: "1", name: "Server rules", note: "a PDF" },
    { id: "2", name: "Client pack", note: "a ZIP" },
];

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: ROWS }), { status: 200 })));
});

const { AdminCrudPage } = await import("@/core/components/admin/AdminCrudPage");

function draw() {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <AdminCrudPage
                title="Downloads"
                subtitle="Files this site offers"
                apiPath="/api/v1/downloads"
                listKey="items"
                displayField="name"
                secondaryField="note"
                fields={[{ key: "name", label: "File name", type: "text" }]}
            />
        </NextIntlClientProvider>,
    );
}

/** The strip that holds the select-all box. */
function bar(): HTMLElement {
    return screen.getByRole("group", { name: MESSAGES.admin.crud_bulkBar });
}

describe("ticking rows on a crud list", () => {
    it("offers a way to tick the whole page", async () => {
        draw();
        expect(await screen.findByRole("checkbox", { name: MESSAGES.admin.crud_selectAll })).toBeTruthy();
    });

    it("says how many are ticked, where the rows are", async () => {
        draw();
        await screen.findByText("Server rules");

        fireEvent.click(screen.getAllByRole("checkbox", { name: MESSAGES.common.common_selectRow ?? "Select row" })[0]);

        await waitFor(() => expect(bar().textContent).toContain("1"));
    });

    it("puts the action that touches them in that same strip", async () => {
        draw();
        await screen.findByText("Server rules");

        fireEvent.click(screen.getAllByRole("checkbox", { name: "Select row" })[0]);

        await waitFor(() => expect(within(bar()).getByRole("button", { name: /delete/i })).toBeTruthy());
    });

    it("keeps that action off the page header, which is for the screen's own", async () => {
        const { container } = draw();
        await screen.findByText("Server rules");

        fireEvent.click(screen.getAllByRole("checkbox", { name: "Select row" })[0]);
        await waitFor(() => expect(within(bar()).getByRole("button", { name: /delete/i })).toBeTruthy());

        const header = container.querySelector("h1")?.closest("div")?.parentElement as HTMLElement;
        expect(within(header).queryByRole("button", { name: /delete/i })).toBeNull();
    });

    it("offers nothing to act on until something is ticked", async () => {
        draw();
        await screen.findByText("Server rules");
        expect(within(bar()).queryByRole("button", { name: /delete/i })).toBeNull();
    });
});
