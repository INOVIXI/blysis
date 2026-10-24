/**
 * The shop's front page says what it is called once.
 *
 * The frame draws the page's title as its h1, and the top level of the shop
 * then opened its list of sections with an h2 reading the same word: "Store",
 * and under it "Store" again. A reader moving by headings heard the page's
 * name twice and never heard what the list under it was. The list is the
 * shop's categories, so that is what its heading says.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import { arrangedPageStub, serverTree } from "../../stubs/server-tree";

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/store/module.json"), "utf8"));
const MESSAGES = MANIFEST.translations.en;

vi.mock("next-intl/server", () => ({
    getTranslations: async (namespace: string) => createTranslator({ locale: "en", messages: MESSAGES, namespace }),
}));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));

vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock("@/core/sdk/layout", () => ({ Slot: () => null }));

// The front as a site whose theme does not arrange it sees it.
vi.mock("@/core/sdk/page", () => ({ ArrangedPage: arrangedPageStub("store", MANIFEST) }));
vi.mock("@/core/sdk/server", () => ({ moduleSettings: async () => ({ lowStockAt: 0 }) }));
vi.mock("@/modules/store/components/FeaturedProduct", () => ({ FeaturedProduct: () => null }));

vi.mock("@/core/sdk/ui", () => ({
    Pagination: () => null,
    RichContent: () => null,
}));

vi.mock("@/modules/store/components/StoreControls", () => ({ StoreSearch: () => null, StoreSort: () => null }));
vi.mock("@/modules/store/components/ProductCard", () => ({ ProductCard: () => null }));

vi.mock("@/modules/store/lib/read-store", () => ({
    STORE_SORTS: ["newest", "price_asc", "price_desc", "popular"],
    readStoreProducts: async () => ({ products: [], lowStockAt: 0, page: 1, pages: 1, total: 0 }),
    readStoreCategories: async () => [
        { id: "c1", name: "Ranks", slug: "ranks", image: null, description: null, layout: "grid", parentId: null, children: [] },
    ],
}));

const StorePage = (await import("@/modules/store/pages/public/page")).default;

describe("the shop says its name once", () => {
    it("heads its list of sections with what the list is", async () => {
        render(await serverTree(StorePage({})));

        const title = screen.getByRole("heading", { level: 1 }).textContent;
        const sections = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

        expect(title).toBe(MESSAGES.store.title);
        expect(sections).not.toContain(title);
        expect(sections).toContain(MESSAGES.store.categories);
    });

    it("shows a showcase and a taste of every shelf only where a theme asks for them", async () => {
        render(await serverTree(StorePage({})));
        const drawn = [...document.querySelectorAll("[data-block]")].map((b) => b.getAttribute("data-block"));
        expect(drawn).toEqual(["store.search", "store.categories"]);
    });
});
