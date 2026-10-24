/**
 * The shop can open the homepage by its shelves.
 *
 * `store.products` draws a few products from one shelf at a time, with a chip
 * for every shelf that has something on it, in the store's own product card
 * so a product looks the same here as in the shop. A shop with no shelves
 * shows its newest products and no chips; a shop with nothing for sale draws
 * nothing.
 *
 * A product's summary is the one line about it a card has room for. The
 * column was there, the search already read it and the panel never asked for
 * it, so no product could have one; both of the panel's product screens now
 * do.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    usePathname: () => "/",
    useRouter: () => ({ push: () => {} }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/core/components/currency/site-currency", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useSiteCurrency: () => ({ format: (value: number) => `$${value}` }),
}));

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/store/module.json"), "utf8"));
const MESSAGES = { ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8")), ...MANIFEST.translations.en };

const shelf = { categories: [] as unknown[], products: {} as Record<string, unknown[]> };
const asked: string[] = [];

const product = (name: string, over: Record<string, unknown> = {}) => ({
    id: name, number: 1, name, slug: name.toLowerCase(), price: 10, image: null, stock: null, shortDesc: null, ...over,
});

const { invalidateShared } = await import("@/core/lib/shared-request");

beforeEach(() => {
    // One request per URL per page: each case here is a page of its own.
    invalidateShared();
    asked.length = 0;
    shelf.categories = [];
    shelf.products = {};
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        asked.push(url);
        if (url.startsWith("/api/v1/store/categories")) return new Response(JSON.stringify({ categories: shelf.categories }));
        const category = new URL(url, "http://x").searchParams.get("category") ?? "";
        return new Response(JSON.stringify({ products: shelf.products[category] ?? [], lowStockAt: 0 }));
    }));
});

const { ProductsBlock } = await import("@/modules/store/components/ProductsBlock");

function draw(settings: Record<string, unknown> = {}) {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <ProductsBlock settings={settings} width="full" />
        </NextIntlClientProvider>,
    );
}

describe("the products block", () => {
    it("is declared as a block a theme places", () => {
        const block = MANIFEST.blocks.find((b: { id: string }) => b.id === "products");
        expect(block?.defaultVisible).toBe(false);
        expect(block?.settings.count).toMatchObject({ type: "number", default: 4 });
    });

    it("opens on the first shelf with something on it, and changes shelf by its chip", async () => {
        shelf.categories = [
            { id: "c0", name: "Empty", slug: "empty", _count: { products: 0 } },
            { id: "c1", name: "Ranks", slug: "ranks", _count: { products: 2 } },
            { id: "c2", name: "Gold", slug: "gold", _count: { products: 1 } },
        ];
        shelf.products = { ranks: [product("Knight", { shortDesc: "A rank of your own." })], gold: [product("1,000 gold")] };
        draw({ count: 4 });
        expect(await screen.findByText("Knight")).toBeTruthy();
        expect(screen.getByText("A rank of your own.")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Empty" })).toBeNull();
        expect(screen.getByRole("button", { name: "Ranks" }).getAttribute("aria-pressed")).toBe("true");
        expect(asked).toContain("/api/v1/store/products?category=ranks&limit=4");
        fireEvent.click(screen.getByRole("button", { name: "Gold" }));
        expect(await screen.findByText("1,000 gold")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Gold" }).getAttribute("aria-pressed")).toBe("true");
    });

    it("holds the room of a row of cards while the shelves are on their way", () => {
        const { container } = draw({});
        expect(container.querySelector('[aria-hidden="true"].invisible a[href^="/store/product/"]')).toBeTruthy();
    });

    it("shows the newest products without chips in a shop with no shelves", async () => {
        shelf.products = { "": [product("Starter kit")] };
        draw({});
        expect(await screen.findByText("Starter kit")).toBeTruthy();
        expect(screen.queryByRole("group")).toBeNull();
    });

    it("draws nothing in a shop with nothing for sale", async () => {
        const { container } = draw({});
        await waitFor(() => expect(asked.some((u) => u.startsWith("/api/v1/store/products"))).toBe(true));
        await waitFor(() => expect(container.innerHTML).toBe(""));
    });
});

describe("a products block whose read did not come back", () => {
    it("says so and can ask again, rather than reading as an empty shop", async () => {
        let down = true;
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            if (down) return new Response("{}", { status: 503 });
            if (url.startsWith("/api/v1/store/categories")) return new Response(JSON.stringify({ categories: [] }));
            return new Response(JSON.stringify({ products: [product("Starter kit")], lowStockAt: 0 }));
        }));
        const { container } = draw({});
        expect(await screen.findByRole("alert")).toBeTruthy();
        expect(container.innerHTML).not.toBe("");
        down = false;
        fireEvent.click(screen.getByRole("button", { name: MESSAGES.common.retry }));
        expect(await screen.findByText("Starter kit")).toBeTruthy();
    });
});

describe("a product's summary", () => {
    it("is told to a shopper", async () => {
        const { PUBLIC_PRODUCT } = await import("@/modules/store/lib/public-product");
        expect(PUBLIC_PRODUCT).toMatchObject({ shortDesc: true });
    });

    it("is asked for on both of the panel's product screens", () => {
        for (const screenFile of ["pages/admin/products/new/page.tsx", "pages/admin/products/[id]/edit/page.tsx"]) {
            const source = fs.readFileSync(path.join(process.cwd(), "module-sources/store", screenFile), "utf8");
            expect(source, screenFile).toContain("shortDesc");
        }
    });
});
