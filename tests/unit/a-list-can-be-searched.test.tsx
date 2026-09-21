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

/**
 * How long a single wait inside one of them may take.
 *
 * Smaller than the test's own ceiling, so a wait that runs out reports the
 * assertion it was retrying rather than the test being killed mid-retry -
 * which is what "expected <p class=\"font-medium\"></p> to be null" was, at
 * 5,179ms under a load average of 17. Both numbers are generous because this
 * box builds and serves nine other projects.
 */
const SETTLE_MS = 10_000;

/*
 * Why these numbers are large, and what was ruled out before enlarging them.
 *
 * This file flaked about one run in five on 2026-09-21 at a load average of
 * sixty, and once on a GitHub runner. The error reads like an assertion -
 * "expected <span class=\"truncate\"></span> to be null" - which sent two
 * attempts looking for a race in the component. It is not one: `waitFor`
 * rethrows its callback's last error when it runs out, so every one of those
 * failures is this wait timing out, on a search that works.
 *
 * Ruled out: the per-test ceiling (raised, then raised globally to twenty
 * seconds); one assertion racing another, which the waits now take together;
 * and the mock handing back a fresh `URLSearchParams` each call, which
 * `useFormRoute` only reads a string out of.
 *
 * Tried and worse, recorded rather than repeated: driving the 300ms debounce
 * with fake timers instead of the clock made all three fail every time. The
 * strip's timer does not survive that environment, which is worth
 * understanding before anybody reaches for it again.
 *
 * Also tried: twenty seconds for the wait and thirty for the test, on the
 * theory that this box starves jsdom. It failed again at a load average of
 * seventeen, so the numbers are back where they were - inflating a limit on a
 * theory that has not been shown is how they got this large already.
 *
 * So the cause is still open. What is known: the row is not removed, it is
 * emptied - the element the failure prints is a display cell with no text in
 * it - and that also explains the third test, because a row that stays means
 * the list is not empty and "No results found" is never drawn. Whatever
 * leaves a row in the list without its name is the thing to find.
 */

describe("a list drawn by the crud shell", () => {
    it("offers a box to search it", async () => {
        draw();
        expect(await screen.findByRole("searchbox")).toBeTruthy();
    });

    it("keeps only the rows that match what was typed", async () => {
        draw();
        await screen.findByText("Server rules");

        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "pack" } });

        // The settled list in one wait rather than one condition waited for
        // and the rest asserted after it. The shell reaches the filtered list
        // over more than one commit, so a wait that watches only the row going
        // away can return on a frame where the rows that stay are not drawn
        // yet - which is one of the two ways this file has flaked.
        await waitFor(() => {
            expect(screen.queryByText("Server rules")).toBeNull();
            expect(screen.getByText("Client pack")).toBeTruthy();
            expect(screen.getByText("Texture pack")).toBeTruthy();
        }, { timeout: SETTLE_MS });
    }, ROOM_FOR_THE_DEBOUNCE);

    it("matches what is under the name as well, because that is on the screen too", async () => {
        draw();
        await screen.findByText("Server rules");

        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "PDF" } });

        await waitFor(() => {
            expect(screen.queryByText("Client pack")).toBeNull();
            expect(screen.getByText("Server rules")).toBeTruthy();
        }, { timeout: SETTLE_MS });
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
        await waitFor(() => {
            expect(screen.getByText(MESSAGES.common.noResults)).toBeTruthy();
            expect(screen.queryByText(MESSAGES.admin.crud_noItems)).toBeNull();
        }, { timeout: SETTLE_MS });
    }, ROOM_FOR_THE_DEBOUNCE);
});
