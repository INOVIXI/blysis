// @vitest-environment jsdom
/**
 * A filter on an order list narrows the list, not the page in front of you.
 *
 * The orders screen is paged by the database - ten at a time - and it filtered
 * by status in the browser, over whichever ten had arrived. So picking
 * "Refunded" on a shop with four hundred orders and two refunds showed
 * nothing at all unless both refunds happened to be among the newest ten, and
 * the number beside each tab was the count on that page: the file said so in
 * a comment, "Count per status from current page".
 *
 * That is worse than no filter. No filter makes an operator page; a filter
 * that answers over one page tells them the refund they are looking at in
 * their bank statement never happened here.
 *
 * The endpoint has taken `status` and `q` since it was written. Both go to
 * it now, and the counts come back from a query over the whole table rather
 * than from the ten rows on screen.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const asked: string[] = [];

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/admin/store/orders",
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/core/sdk", () => ({
    formatDate: (d: string) => d,
    dateLocaleTag: () => "en-GB",
}));
vi.mock("@/core/sdk/ui", () => {
    return {
        // A plain box rather than the real strip: what is being asked here is
        // what the screen does with the term, not how the strip debounces it.
        ListControls: ({ search }: { search?: { value: string; onChange: (v: string) => void } }) => (
            <input type="search" value={search?.value ?? ""} onChange={(e) => search?.onChange(e.target.value)} />
        ),
        Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
        Button: ({ children, ...rest }: React.ComponentProps<"button">) => <button {...rest}>{children}</button>,
        Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
        Pagination: () => null,
        buttonClassName: () => "",
        useFormRoute: () => ({ showForm: false, formHref: () => "#", closeForm: () => {} }),
        useSiteCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}` }),
    };
});
vi.mock("@/core/sdk/admin", () => ({
    AdminPageHeader: ({ title }: { title: React.ReactNode }) => <h1>{title}</h1>,
}));
vi.mock("./NewOrderForm", () => ({ NewOrderForm: () => null }));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/store/module.json"), "utf8"));
const messages = { ...MESSAGES, store: MANIFEST.translations.en.store, ...MANIFEST.translations.en };

beforeEach(() => {
    asked.length = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
            asked.push(String(url));
            return new Response(
                JSON.stringify({
                    orders: [],
                    counts: { CANCELLED: 40 },
                    pagination: { page: 1, limit: 10, total: 400, pages: 40 },
                }),
                { status: 200 },
            );
        }),
    );
});

const { default: AdminOrdersPage } = await import("@/modules/store/pages/admin/orders/page");

function draw() {
    return render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <AdminOrdersPage />
        </NextIntlClientProvider>,
    );
}

describe("the orders screen", () => {
    it("asks the endpoint for the status, rather than sieving the page", async () => {
        draw();
        await waitFor(() => expect(asked.length).toBeGreaterThan(0));

        fireEvent.click(screen.getByRole("button", { name: /cancelled/i }));
        await waitFor(() => expect(asked.at(-1)).toContain("status=CANCELLED"));
    });

    it("counts a status over the whole table, not over the rows on screen", async () => {
        draw();
        expect(await screen.findByText("(40)")).toBeTruthy();
    });

    it("sends what was typed, because the endpoint has always taken it", async () => {
        draw();
        await waitFor(() => expect(asked.length).toBeGreaterThan(0));

        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "BLY-1042" } });
        await waitFor(() => expect(asked.at(-1)).toContain("q=BLY-1042"));
    });
});
