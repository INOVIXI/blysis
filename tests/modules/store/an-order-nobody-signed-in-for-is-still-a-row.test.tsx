// @vitest-environment jsdom
/**
 * An order without an account behind it is still an order.
 *
 * The shop has taken orders that belong to no member since an operator could
 * enter one for a sale that happened elsewhere, and it keeps an order whose
 * member has since deleted their account: a sale is a record, and deleting
 * the person does not undo the money. `Order.userId` is nullable and has
 * been for as long as both of those have existed.
 *
 * The list of orders read `order.user.username` with no guard, and the type
 * beside it declared `user` as always present - so nothing complained, and
 * the screen threw `Cannot read properties of null (reading 'username')` the
 * moment one of those rows reached it. Measured on the demo data on
 * 2026-09-21: twelve of forty-eight orders have no user, so the screen was
 * broken for any shop that had ever taken one.
 *
 * The detail screen already guarded it and then printed "Deleted user", in
 * English, on a site that speaks two languages.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/admin/store/orders",
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/admin/store/orders",
    useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/core/sdk/ui", () => ({
    Button: ({ children, ...rest }: React.ComponentProps<"button">) => <button {...rest}>{children}</button>,
    Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Pagination: () => null,
    ListControls: () => null,
    RowActions: () => null,
    buttonClassName: () => "",
    useSiteCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}` }),
    useLocalDate: () => () => "01.01.2026",
    useLocalDateTime: () => () => "01.01.2026 10:00",
    useFormRoute: () => ({ showForm: false, editingId: null, formHref: () => "?form=new", openForm: () => {}, closeForm: () => {} }),
    useRowList: <T,>(rows: T[]) => ({ rows, page: 1, pages: 1, total: rows.length, search: "", setSearch: () => {} }),
    useConfirm: () => ({ confirm: async () => true }),
    Waiting: () => null,
    LoadFailed: () => null,
    Select: ({ children }: { children?: React.ReactNode }) => <select>{children}</select>,
    NativeSelect: ({ children }: { children?: React.ReactNode }) => <select>{children}</select>,
    Input: (p: React.ComponentProps<"input">) => <input {...p} />,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/core/sdk", () => ({
    errorMessage: () => "went wrong",
    formatDate: () => "01.01.2026",
    dateLocaleTag: () => "en-GB",
    useDateLocaleTag: () => "en-GB",
}));
vi.mock("@/core/sdk/admin", () => ({
    AdminPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
    FilterChips: () => null,
}));
vi.mock("./NewOrderForm", () => ({ NewOrderForm: () => null }));

const item = { id: "i1", quantity: 1, price: 9.99, product: { name: "VIP" } };

/** One with an account behind it, one without. Both are orders. */
const ORDERS = [
    {
        id: "o1", orderNumber: "BLY-1001", status: "PAID", total: 9.99,
        createdAt: "2026-01-01T10:00:00.000Z", items: [item],
        user: { id: "u1", username: "thora", email: "thora@example.invalid" },
    },
    {
        id: "o2", orderNumber: "BLY-1002", status: "PAID", total: 19.99,
        createdAt: "2026-01-02T10:00:00.000Z", items: [item],
        user: null,
    },
];

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ orders: ORDERS, pagination: { total: 2, pages: 1 } }),
    })) as unknown as typeof fetch);
});

async function renderPage() {
    const { default: Page } = await import("../../../module-sources/store/pages/admin/orders/page");
    render(
        <NextIntlClientProvider
            locale="en"
            messages={{ store: { adm_noAccount: "No account" } }}
            onError={() => {}}
            getMessageFallback={({ key }) => key}
        >
            <Page />
        </NextIntlClientProvider>,
    );
}

describe("the list of orders", () => {
    it("draws the order whose member has an account", async () => {
        await renderPage();
        await waitFor(() => expect(screen.getByText("BLY-1001")).toBeDefined());
        expect(screen.getByText("thora")).toBeDefined();
    });

    it("draws the order that has no member, rather than throwing", async () => {
        await renderPage();
        await waitFor(() => expect(screen.getByText("BLY-1002")).toBeDefined());
    });

    it("says so in words rather than leaving the column blank", async () => {
        // A blank cell reads as a member whose name did not load. There is no
        // member, and the screen should say that.
        await renderPage();
        await waitFor(() => expect(screen.getByText("BLY-1002")).toBeDefined());
        expect(screen.getByText("No account")).toBeDefined();
    });
});
