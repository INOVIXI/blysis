/**
 * A product need not belong to a category.
 *
 * `Product.categoryId` is nullable in the schema and the admin screen lets an
 * operator leave it empty, so a shop that does not sort its products into
 * categories is a shop the platform supports. The detail page's own `Product`
 * type said otherwise - `category` was declared as an object, never null - and
 * the footer of the page read `product.category.name` on the strength of it.
 * Opening any uncategorised product threw before the page rendered.
 *
 * The type now says what the column says. This is what proves the page draws
 * anyway, because a type is only checked where somebody is looking.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
    useParams: () => ({ params: ["4", "a-thing"] }),
    usePathname: () => "/store/product/4/a-thing",
}));

vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "unauthenticated" }) }));

vi.mock("next/image", () => ({
    default: ({ alt }: { alt: string }) => <span data-testid="image" aria-label={alt} />,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/core/sdk/layout", () => ({
    PageFrame: ({ title, children }: { title: string; children: React.ReactNode }) => (
        <main><h1>{title}</h1>{children}</main>
    ),
}));

vi.mock("@/core/sdk", () => ({ errorMessage: () => "went wrong" }));

vi.mock("@/core/sdk/ui", () => ({
    Button: ({ children, ...rest }: React.ComponentProps<"button">) => <button {...rest}>{children}</button>,
    NativeSelect: (props: React.ComponentProps<"select">) => <select {...props} />,
    RichContent: ({ html }: { html: string }) => <div>{html}</div>,
    useSiteCurrency: () => ({ format: (value: number) => `$${value}` }),
    buttonClassName: () => "",
}));

/**
 * The module's own strings and the core's, rather than a handful written here:
 * a page rendered against invented messages is a page rendered against a
 * different vocabulary from the one it ships with.
 */
const MESSAGES = {
    ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8")),
    ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/store/module.json"), "utf8"))
        .translations.en,
};

const PRODUCT = {
    id: "p1",
    number: 4,
    name: "A thing with no category",
    slug: "a-thing",
    description: null,
    price: 10,
    comparePrice: null,
    image: null,
    stock: null,
    isActive: true,
    // The shape the endpoint actually returns for a product nobody filed.
    category: null,
};

// The page is a server component now - it reads the product and hands it over.
// The screen is what draws it, so the screen is what this asks.
const { ProductView } = await import("@/modules/store/components/ProductView");

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
        new Response(
            JSON.stringify(url.includes("product-variables") ? { variables: [] } : { product: PRODUCT }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ));
});

describe("a product filed under nothing", () => {
    it("still has a page a shopper can read", async () => {
        render(
            <NextIntlClientProvider locale="en" messages={MESSAGES}>
                <ProductView product={PRODUCT} />
            </NextIntlClientProvider>,
        );

        // The name appears twice: the frame titles the page with it and the
        // panel repeats it, which is the page's own shape and not the point
        // here.
        await waitFor(() => {
            expect(screen.getAllByText("A thing with no category").length).toBeGreaterThan(0);
        });

        // And the line that named the category is simply not drawn, rather
        // than drawn empty or drawn as "Category: undefined".
        expect(screen.queryByText(/^Category:/)).toBeNull();
    });
});
