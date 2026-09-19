// @vitest-environment jsdom
/**
 * A list that can grow can be searched.
 *
 * Measured across the panel on 2026-09-19: 156 admin screens, 67 of them
 * showing a list, and three with a box to search it. Every one of those lists
 * grows without bound - downloads, redirects, departments, trophies, coupons -
 * and the only way to reach a row that is not on the first page was to page
 * through until it appeared.
 *
 * Fifteen of them are drawn by the crud shell, so the shell is where the box
 * belongs: written once, in the same place, with the same placeholder, rather
 * than fifteen boxes each with their own spacing and their own idea of where
 * a magnifier goes. `ListControls` already existed for exactly that and no
 * admin screen used it.
 *
 * The rows are already in the browser - the shell fetches the list and pages
 * it there - so the search narrows what it holds rather than asking again,
 * and the reader sees the answer as they type.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
    { id: "3", name: "Texture pack", note: "a ZIP" },
];

beforeEach(() => {
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ items: ROWS }), { status: 200 })),
    );
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

/**
 * How long a test that waits out the debounce is given.
 *
 * The waits inside these tests already ask for five seconds, and vitest's own
 * per-test ceiling is five seconds too, so the test was killed at the exact
 * moment its wait was entitled to keep waiting: raising the inner number
 * bought nothing. Measured on 2026-09-19 at a load average of 29, one of them
 * finished at 5,025ms and failed. The outer ceiling has to be the larger of
 * the two.
 */
const ROOM_FOR_THE_DEBOUNCE = 15_000;

describe("a list drawn by the crud shell", () => {
    it("offers a box to search it", async () => {
        draw();
        expect(await screen.findByRole("searchbox")).toBeTruthy();
    });

    it("keeps only the rows that match what was typed", async () => {
        draw();
        await screen.findByText("Server rules");

        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "pack" } });

        await waitFor(() => expect(screen.queryByText("Server rules")).toBeNull(), { timeout: 5000 });
        expect(screen.getByText("Client pack")).toBeTruthy();
        expect(screen.getByText("Texture pack")).toBeTruthy();
    }, ROOM_FOR_THE_DEBOUNCE);

    it("matches what is under the name as well, because that is on the screen too", async () => {
        draw();
        await screen.findByText("Server rules");

        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "PDF" } });

        await waitFor(() => expect(screen.queryByText("Client pack")).toBeNull(), { timeout: 5000 });
        expect(screen.getByText("Server rules")).toBeTruthy();
    }, ROOM_FOR_THE_DEBOUNCE);

    it("says the search found nothing, not that there is nothing", async () => {
        // "No items yet" in front of a full list is the panel telling an
        // operator their data is gone.
        draw();
        await screen.findByText("Server rules");

        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nothing matches this" } });

        // The strip waits 300ms before it tells anybody, and this box is
        // shared with eight other test files: the default one-second ceiling
        // is not enough room for a debounce under that load.
        expect(await screen.findByText(MESSAGES.common.noResults, {}, { timeout: 5000 })).toBeTruthy();
        expect(screen.queryByText(MESSAGES.admin.crud_noItems)).toBeNull();
    }, ROOM_FOR_THE_DEBOUNCE);
});
