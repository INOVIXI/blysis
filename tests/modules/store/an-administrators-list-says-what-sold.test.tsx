/**
 * The sales column counts sales.
 *
 * It printed `product._count.orderItems`, and the endpoint behind the screen
 * selects the product's own columns and its category. It has never sent a
 * `_count`, so the column has read `undefined` and drawn the `|| 0` behind it
 * since it was written: every product in every install, however much it had
 * sold, said zero.
 *
 * `unitsSold` is the number to draw. It is incremented where a claim is paid
 * for and decremented where one is refunded, which is also what the public
 * "most popular" ordering reads, so the shop's two answers to "what sells"
 * now come from the same column.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/image", () => ({
    default: ({ alt }: { alt: string }) => <span aria-label={alt} />,
}));

/**
 * The panel's own widgets, stubbed to what this test is about.
 *
 * `@/core/sdk/ui` reaches the locale-aware navigation, which resolves only
 * inside a Next request. The screen under test is a table; the chrome around
 * it is not what is being asked about.
 */
vi.mock("@/core/sdk/ui", () => ({
    Button: ({ children, ...rest }: React.ComponentProps<"button">) => <button {...rest}>{children}</button>,
    Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    Pagination: () => null,
    ListControls: () => null,
    buttonClassName: () => "",
    useSiteCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}` }),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
    usePathname: () => "/admin/store/products",
    useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/core/sdk", () => ({ errorMessage: () => "went wrong" }));
vi.mock("@/core/sdk/admin", () => ({
    AdminPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

/** What the real endpoint answers: the product's own columns, and a category. */
const PRODUCT = {
    id: "p1",
    name: "VIP+",
    slug: "vip-plus",
    price: 19.99,
    stock: null,
    image: null,
    isActive: true,
    isFeatured: false,
    unitsSold: 7,
    category: { name: "Ranks" },
};

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
        ok: true,
        json: async () => ({ products: [PRODUCT], pagination: { total: 1, pages: 1 } }),
    })) as unknown as typeof fetch);
});

async function renderPage() {
    const { default: Page } = await import("../../../module-sources/store/pages/admin/products/page");
    render(
        <NextIntlClientProvider locale="en" messages={{}} onError={() => {}} getMessageFallback={({ key }) => key}>
            <Page />
        </NextIntlClientProvider>,
    );
}

describe("an administrator's list says what sold", () => {
    it("prints the number of units the shop has sold", async () => {
        await renderPage();
        await waitFor(() => expect(screen.getByText("VIP+")).toBeDefined());
        expect(screen.getByText("7")).toBeDefined();
    });
});
