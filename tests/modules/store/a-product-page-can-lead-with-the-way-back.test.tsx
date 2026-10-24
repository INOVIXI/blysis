/**
 * A product's page can say where it stands in the shop without a header.
 *
 * The frame's header carries the crumb trail, so a theme that hides it to
 * open the page on the product itself lost the way back to the product's
 * shelf with it. The page offers the trail as a block of its own, the shop,
 * the product's section and the product, which such a theme places; a site
 * whose theme keeps the header does not draw it twice.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import fs from "node:fs";
import path from "node:path";
import { serverTree } from "../../stubs/server-tree";

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "module-sources/store/module.json"), "utf8"));
const MESSAGES = MANIFEST.translations.en;

vi.mock("next-intl/server", () => ({
    getTranslations: async (namespace: string) => createTranslator({ locale: "en", messages: MESSAGES, namespace }),
}));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));

vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const arranged = vi.hoisted(() => ({ layouts: {} as Record<string, unknown> }));

vi.mock("@/core/sdk/server", async () => {
    const { arrangedPageStub: stub } = await import("../../stubs/server-tree");
    const manifest = JSON.parse((await import("node:fs")).readFileSync(
        (await import("node:path")).join(process.cwd(), "module-sources/store/module.json"), "utf8"));
    return {
        ArrangedPage: async (props: Parameters<ReturnType<typeof stub>>[0]) =>
            stub("store", manifest, arranged.layouts as Parameters<typeof stub>[2])(props),
        moduleSettings: async () => ({ lowStockAt: 0 }),
    };
});

vi.mock("@/core/sdk/ui", () => ({ RichContent: () => null }));
vi.mock("@/modules/store/components/ProductGallery", () => ({ ProductGallery: () => null }));
vi.mock("@/modules/store/components/ProductView", () => ({ ProductView: () => null }));
vi.mock("@/modules/store/components/ProductCard", () => ({ ProductCard: () => null }));
vi.mock("@/modules/store/lib/read-bulk-rules", () => ({ readBulkLadder: async () => [] }));
vi.mock("@/modules/store/lib/read-store", () => ({ readRelated: async () => [] }));

const product = vi.hoisted(() => ({ category: { id: "c1", name: "Ranks", slug: "ranks" } as { id: string; name: string; slug: string } | null }));

vi.mock("@/modules/store/lib/read-product", () => ({
    readProduct: async () => ({
        id: "p1",
        number: 4,
        name: "Emerald",
        slug: "emerald",
        description: null,
        image: null,
        images: [],
        category: product.category,
        availability: { opensAt: null, closesAt: null },
    }),
}));

const ProductPage = (await import("@/modules/store/pages/public/product/[...params]/page")).default;
const page = () => ProductPage({ params: Promise.resolve({ params: ["4", "emerald"] }) });

const LEADS_WITH_CRUMBS = {
    "store.product": {
        header: "hidden",
        rows: [{ split: "1", cells: [[{ key: "crumbs", block: "store.crumbs" }, { key: "buy", block: "store.buy" }]] }],
    },
};

describe("a product page can lead with the way back", () => {
    it("names the shop and the product's section as links, and the product last", async () => {
        arranged.layouts = LEADS_WITH_CRUMBS;
        product.category = { id: "c1", name: "Ranks", slug: "ranks" };
        render(await serverTree(page()));

        const trail = screen.getByRole("navigation");
        const links = [...trail.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
        expect(links).toEqual([[MESSAGES.store.title, "/store"], ["Ranks", "/store?category=ranks"]]);
        expect(trail.lastElementChild?.textContent).toBe("Emerald");
    });

    it("leads from the shop straight to a product filed in no section", async () => {
        arranged.layouts = LEADS_WITH_CRUMBS;
        product.category = null;
        render(await serverTree(page()));

        const links = [...screen.getByRole("navigation").querySelectorAll("a")].map((a) => a.getAttribute("href"));
        expect(links).toEqual(["/store"]);
    });

    it("is not drawn where the header already carries the trail", async () => {
        arranged.layouts = {};
        render(await serverTree(page()));
        expect(document.querySelector('[data-block="store.crumbs"]')).toBeNull();
    });
});
