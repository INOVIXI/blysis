import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Where a per-page SEO override actually lands.
 *
 * The overrides existed, an operator could set them, and the screen that set
 * them looked like it worked. They reached a crawler through a client
 * component that fetched the row after the page had loaded and rewrote
 * `document.head`: a crawler reads the HTML the server sent and does not run
 * it, so the title, the description and the `noindex` an operator set were
 * invisible to the only reader they were set for. An unfurled link in chat
 * showed the same.
 *
 * The module could not do better on its own: `generateMetadata` is a route
 * segment export and the pages belong to other modules. So core asks, while it
 * is building the head, and applies whatever comes back. That question is what
 * this file defends: core has to ask it, and what comes back has to survive
 * into the metadata.
 */

const { setting, resolveAppUrl, serverConfig, ensureHooks } = vi.hoisted(() => ({
    setting: { findMany: vi.fn(async () => []) },
    resolveAppUrl: vi.fn(() => "https://games.example"),
    serverConfig: { name: "Blysis", description: "A community site" },
    ensureHooks: vi.fn(async () => {}),
}));
vi.mock("@/core/lib/db", () => ({ prisma: { setting }, default: { setting } }));
vi.mock("@/core/lib/app-url", () => ({ resolveAppUrl }));
vi.mock("@/core/config/server", () => ({ serverConfig }));
vi.mock("@/core/lib/hooks-bootstrap", () => ({ ensureHooks }));

const { buildPageMeta } = await import("@/core/lib/seo");
const { addFilter, resetHooks } = await import("@/core/lib/hooks");

/** The answer a listener with nothing to say hands back untouched. */
function silent(value: PageMetaOverride): PageMetaOverride {
    return value;
}

describe("a page's head", () => {
    beforeEach(() => resetHooks());

    it("is what the page said, when nothing has an opinion", async () => {
        const meta = await buildPageMeta({ title: "Store", description: "Buy things", url: "/store", locale: "en" });
        expect(meta.title).toBe("Store");
        expect(meta.description).toBe("Buy things");
        expect(meta.robots).toBeUndefined();
    });

    it("carries the title and description an operator set", async () => {
        addFilter("seo.pageMeta", (value) => ({ ...value, title: "Our shop", description: "Everything we sell" }));
        const meta = await buildPageMeta({ title: "Store", description: "Buy things", url: "/store", locale: "en" });
        expect(meta.title).toBe("Our shop");
        expect(meta.description).toBe("Everything we sell");
        // The share card says it too, which is the half an unfurled link reads.
        expect(meta.openGraph?.title).toBe("Our shop");
        expect(meta.twitter?.description).toBe("Everything we sell");
    });

    it("lets the share card be worded differently from the search result", async () => {
        addFilter("seo.pageMeta", (value) => ({ ...value, ogTitle: "Join us", ogDescription: "Come in" }));
        const meta = await buildPageMeta({ title: "Store", description: "Buy things", url: "/store", locale: "en" });
        expect(meta.title).toBe("Store");
        expect(meta.openGraph?.title).toBe("Join us");
        expect(meta.openGraph?.description).toBe("Come in");
    });

    it("keeps a page out of the index when it has been told to", async () => {
        addFilter("seo.pageMeta", (value) => ({ ...value, noIndex: true, noFollow: true }));
        const meta = await buildPageMeta({ title: "Store", url: "/store", locale: "en" });
        expect(meta.robots).toEqual({ index: false, follow: false });
    });

    it("replaces the canonical without unpublishing the hreflang set", async () => {
        addFilter("seo.pageMeta", (value) => ({ ...value, canonical: "https://games.example/en/shop" }));
        const meta = await buildPageMeta({ title: "Store", url: "/store", locale: "en" });
        expect(meta.alternates?.canonical).toBe("https://games.example/en/shop");
        expect((meta.alternates?.languages as Record<string, string>)?.tr).toBe("https://games.example/tr/store");
    });

    it("asks about the page being built, not about the site", async () => {
        const asked: unknown[] = [];
        addFilter("seo.pageMeta", (value, context) => {
            asked.push(context);
            return silent(value);
        });
        await buildPageMeta({ title: "Cart", description: "What you are buying", url: "/store/cart", locale: "tr" });
        // The head core has built so far travels with the question, so a
        // listener can tell an override from a fallback: a site-wide share
        // image has to lose to one the page chose for itself.
        expect(asked).toEqual([
            { path: "/store/cart", locale: "tr", title: "Cart", description: "What you are buying", image: null },
        ]);
    });

    it("bootstraps the bus before asking", async () => {
        // A filter nobody registered in this module graph answers with the
        // value it was given and no error, which is how this stayed silent.
        ensureHooks.mockClear();
        await buildPageMeta({ title: "Store", url: "/store", locale: "en" });
        expect(ensureHooks).toHaveBeenCalled();
    });

    it("survives a listener that throws", async () => {
        addFilter("seo.pageMeta", () => {
            throw new Error("no database");
        });
        const meta = await buildPageMeta({ title: "Store", description: "Buy things", url: "/store", locale: "en" });
        expect(meta.title).toBe("Store");
    });
});

describe("the module that answers", () => {
    const manifest = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "module-sources/seo/module.json"), "utf8"),
    ) as { hookListeners?: { hook: string; type: string }[]; layoutComponents?: unknown[] };

    it("listens for the question core asks", () => {
        expect(manifest.hookListeners).toContainEqual(
            expect.objectContaining({ hook: "seo.pageMeta", type: "filter" }),
        );
    });

    it("ships nothing that rewrites the head in the browser", () => {
        // The layout component it used to mount is what a crawler never ran.
        expect(manifest.layoutComponents).toBeUndefined();
        const sources = fs.readdirSync(path.join(process.cwd(), "module-sources/seo"), { recursive: true }) as string[];
        expect(sources.filter((f) => String(f).endsWith("SeoHead.tsx"))).toEqual([]);
    });
});
