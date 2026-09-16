import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The JSON-LD builders interpolate database-sourced strings into a
 * `<script type="application/ld+json">` block. The `<` escape is the only
 * thing stopping a site name containing `</script>` from breaking out of
 * that tag, and it had no test. The URL absolutisation matters for a
 * different reason: a relative canonical or og:image is what makes a
 * prebuilt image advertise localhost to crawlers.
 */

const { setting, resolveAppUrl, serverConfig } = vi.hoisted(() => ({
    setting: { findMany: vi.fn() },
    resolveAppUrl: vi.fn(() => "https://games.example"),
    serverConfig: { name: "Blysis", description: "Default description" },
}));

vi.mock("@/core/lib/db", () => ({ prisma: { setting }, default: { setting } }));
vi.mock("@/core/lib/app-url", () => ({ resolveAppUrl }));
vi.mock("@/core/config/server", () => ({ serverConfig }));

import type { Metadata } from "next";
import {
    buildPageMeta,
    buildArticleJsonLd,
    buildOrganizationJsonLd,
} from "@/core/lib/seo";

/**
 * Next's Metadata types are unions, so `openGraph.type` and `twitter.card`
 * are not reachable through the declared shape even though the builders
 * always set them.
 */
const og = (meta: Metadata) => meta.openGraph as unknown as Record<string, unknown>;
const tw = (meta: Metadata) => meta.twitter as unknown as Record<string, unknown>;

beforeEach(() => {
    setting.findMany.mockReset().mockResolvedValue([]);
    resolveAppUrl.mockReset().mockReturnValue("https://games.example");
    serverConfig.name = "Blysis";
    serverConfig.description = "Default description";
});

// ===========================================================================

describe("buildPageMeta", () => {
    it("uses the title as given", async () => {
        const meta = await buildPageMeta({ title: "Servers" });
        expect(meta.title).toBe("Servers");
        expect(meta.openGraph?.title).toBe("Servers");
    });

    it("falls back to the site description", async () => {
        const meta = await buildPageMeta({ title: "Servers" });
        expect(meta.description).toBe("Default description");
    });

    it("prefers an explicit description", async () => {
        const meta = await buildPageMeta({ title: "Servers", description: "Our servers" });
        expect(meta.description).toBe("Our servers");
    });

    it("reads the site name and description from settings", async () => {
        setting.findMany.mockResolvedValue([
            { key: "site_name", value: "Acme Games" },
            { key: "site_description", value: "From the database" },
        ]);

        const meta = await buildPageMeta({ title: "Servers" });

        expect(meta.openGraph?.siteName).toBe("Acme Games");
        expect(meta.description).toBe("From the database");
    });

    it("asks for only the two seo keys", async () => {
        await buildPageMeta({ title: "x" });
        expect(setting.findMany).toHaveBeenCalledWith({
            where: { key: { in: ["site_name", "site_description"] } },
        });
    });

    it("coerces a non-string setting value", async () => {
        setting.findMany.mockResolvedValue([{ key: "site_name", value: 42 }]);
        const meta = await buildPageMeta({ title: "x" });
        expect(meta.openGraph?.siteName).toBe("42");
    });

    it("ignores an empty setting value rather than blanking the default", async () => {
        setting.findMany.mockResolvedValue([{ key: "site_name", value: "" }]);
        const meta = await buildPageMeta({ title: "x" });
        expect(meta.openGraph?.siteName).toBe("Blysis");
    });

    it("falls back to the defaults when the database is unavailable", async () => {
        setting.findMany.mockRejectedValue(new Error("db down"));

        // This runs during `next build`, where DATABASE_URL may not resolve.
        const meta = await buildPageMeta({ title: "x" });
        expect(meta.openGraph?.siteName).toBe("Blysis");
    });

    it("tolerates a serverConfig with no description", async () => {
        serverConfig.description = "";
        const meta = await buildPageMeta({ title: "x" });
        expect(meta.description).toBe("");
    });
});

describe("url absolutisation", () => {
    it("prefixes a path with the resolved site url", async () => {
        const meta = await buildPageMeta({ title: "x", url: "/servers" });
        expect(meta.openGraph?.url).toBe("https://games.example/servers");
    });

    it("inserts the missing slash for a bare path", async () => {
        const meta = await buildPageMeta({ title: "x", url: "servers" });
        expect(meta.openGraph?.url).toBe("https://games.example/servers");
    });

    it("leaves an already-absolute url alone", async () => {
        const meta = await buildPageMeta({ title: "x", url: "https://other.test/a" });
        expect(meta.openGraph?.url).toBe("https://other.test/a");
    });

    it("omits the url entirely when none is given", async () => {
        const meta = await buildPageMeta({ title: "x" });
        expect(meta.openGraph).not.toHaveProperty("url");
    });

    it("resolves the site url at call time, not at build time", async () => {
        resolveAppUrl.mockReturnValue("https://renamed.example");
        const meta = await buildPageMeta({ title: "x", url: "/a" });

        // Baking NEXT_PUBLIC_SITE_URL in put localhost in every canonical tag
        // of every prebuilt-image install.
        expect(meta.openGraph?.url).toBe("https://renamed.example/a");
    });
});

describe("images and cards", () => {
    it("absolutises a relative image", async () => {
        const meta = await buildPageMeta({ title: "x", image: "/og.png" });
        expect(meta.openGraph?.images).toEqual([
            { url: "https://games.example/og.png", alt: "x" },
        ]);
    });

    it("keeps an absolute image", async () => {
        const meta = await buildPageMeta({ title: "x", image: "https://cdn.test/og.png" });
        expect(meta.twitter?.images).toEqual(["https://cdn.test/og.png"]);
    });

    it("asks for a large twitter card when there is an image", async () => {
        const meta = await buildPageMeta({ title: "x", image: "/og.png" });
        expect(tw(meta).card).toBe("summary_large_image");
    });

    it("falls back to a plain summary card without one", async () => {
        const meta = await buildPageMeta({ title: "x" });
        expect(tw(meta).card).toBe("summary");
        expect(meta.twitter).not.toHaveProperty("images");
    });
});

describe("open graph type", () => {
    it("defaults to website", async () => {
        const meta = await buildPageMeta({ title: "x" });
        expect(og(meta).type).toBe("website");
    });

    it("carries article metadata only for articles", async () => {
        const meta = await buildPageMeta({
            title: "x", type: "article",
            publishedTime: "2026-01-01T00:00:00.000Z", authorName: "Ada",
        });

        expect(meta.openGraph).toMatchObject({
            type: "article",
            publishedTime: "2026-01-01T00:00:00.000Z",
            authors: ["Ada"],
        });
    });

    it("drops article fields on a non-article page", async () => {
        const meta = await buildPageMeta({
            title: "x", type: "website",
            publishedTime: "2026-01-01T00:00:00.000Z", authorName: "Ada",
        });

        expect(meta.openGraph).not.toHaveProperty("publishedTime");
        expect(meta.openGraph).not.toHaveProperty("authors");
    });
});

describe("the card a link unfurls into", () => {
    it("is the big one when the page brought its own picture", async () => {
        const meta = await buildPageMeta({ title: "Patch notes", url: "/blog/patch", image: "/covers/patch.png" });
        expect(tw(meta).card).toBe("summary_large_image");
        expect(meta.twitter?.images).toEqual(["https://games.example/covers/patch.png"]);
    });

    it("is the small one when the page has no picture of its own", async () => {
        // The fallback is the site's own mark, which is square: stretched
        // across a 2:1 banner it looked like a mistake on every unfurl.
        const meta = await buildPageMeta({ title: "Leaderboard", url: "/leaderboard" });
        expect(tw(meta).card).toBe("summary");
    });
});

describe("buildArticleJsonLd", () => {
    const base = { title: "Patch notes", url: "/blog/patch" };

    it("emits a schema.org Article", () => {
        const ld = JSON.parse(buildArticleJsonLd(base));
        expect(ld["@context"]).toBe("https://schema.org");
        expect(ld["@type"]).toBe("Article");
        expect(ld.headline).toBe("Patch notes");
    });

    it("absolutises the canonical url", () => {
        const ld = JSON.parse(buildArticleJsonLd(base));
        expect(ld.mainEntityOfPage["@id"]).toBe("https://games.example/blog/patch");
    });

    it("keeps an already-absolute url", () => {
        const ld = JSON.parse(buildArticleJsonLd({ ...base, url: "https://x.test/a" }));
        expect(ld.mainEntityOfPage["@id"]).toBe("https://x.test/a");
    });

    it("inserts the missing slash", () => {
        const ld = JSON.parse(buildArticleJsonLd({ ...base, url: "blog/patch" }));
        expect(ld.mainEntityOfPage["@id"]).toBe("https://games.example/blog/patch");
    });

    it("names the site as publisher", () => {
        const ld = JSON.parse(buildArticleJsonLd(base));
        expect(ld.publisher).toEqual({
            "@type": "Organization", name: "Blysis", url: "https://games.example",
        });
    });

    it("includes an absolutised image when given", () => {
        const ld = JSON.parse(buildArticleJsonLd({ ...base, image: "/hero.png" }));
        expect(ld.image).toEqual(["https://games.example/hero.png"]);
    });

    it("omits image and dates when they are absent", () => {
        const ld = JSON.parse(buildArticleJsonLd(base));
        expect(ld).not.toHaveProperty("image");
        expect(ld).not.toHaveProperty("datePublished");
        expect(ld).not.toHaveProperty("author");
    });

    it("includes the dates and author when given", () => {
        const ld = JSON.parse(buildArticleJsonLd({
            ...base,
            datePublished: "2026-01-01", dateModified: "2026-02-01", authorName: "Ada",
        }));

        expect(ld.datePublished).toBe("2026-01-01");
        expect(ld.dateModified).toBe("2026-02-01");
        expect(ld.author).toEqual({ "@type": "Person", name: "Ada" });
    });

    it("escapes every angle bracket so the value cannot close the script tag", () => {
        const out = buildArticleJsonLd({ ...base, title: "</script><img src=x onerror=alert(1)>" });

        expect(out).not.toContain("<");
        expect(out).toContain("\\u003c");
    });

    it("still parses as JSON after escaping", () => {
        const out = buildArticleJsonLd({ ...base, title: "a < b" });
        expect(JSON.parse(out).headline).toBe("a < b");
    });
});

describe("buildOrganizationJsonLd", () => {
    it("emits a schema.org Organization from the sync config", () => {
        const ld = JSON.parse(buildOrganizationJsonLd());

        expect(ld).toEqual({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "Blysis",
            url: "https://games.example",
            description: "Default description",
        });
    });

    it("escapes angle brackets in an operator-supplied name", () => {
        serverConfig.name = "</script><script>alert(1)</script>";

        const out = buildOrganizationJsonLd();

        expect(out).not.toContain("<");
        expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
    });

    it("tolerates an empty description", () => {
        serverConfig.description = "";
        expect(JSON.parse(buildOrganizationJsonLd()).description).toBe("");
    });
});
