// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * What a link to this site shows when somebody pastes it into a chat.
 *
 * Nothing on the site carried an `og:image`, so every link unfurled as a bare
 * line of text. The setting for one existed on the SEO screen and was read by
 * nothing at all.
 *
 * Three tiers, and the order is the whole point: what an operator set for this
 * path, then the picture the page itself chose, then the site's own mark. The
 * middle tier is the one that is easy to get wrong - a site-wide default that
 * beat an article's cover would replace every share image on the site with a
 * logo. Core hands the page's own answer over in the context so this can tell
 * an override from a fallback.
 */

const { findUnique, readSettingStrings } = vi.hoisted(() => ({
    findUnique: vi.fn(),
    readSettingStrings: vi.fn(),
}));
vi.mock("@/core/sdk/server", () => ({ prisma: { seoPage: { findUnique } }, readSettingStrings }));

const { default: onPageMeta } = await import("../../../module-sources/seo/hooks/page-meta");

const EMPTY: PageMetaOverride = {
    title: null,
    description: null,
    ogTitle: null,
    ogDescription: null,
    image: null,
    canonical: null,
    keywords: null,
    noIndex: false,
    noFollow: false,
};

/** What core has built for the page it is asking about. */
function asking(image: string | null) {
    return { path: "/store", locale: "en", title: "Store", description: "Buy things", image };
}

describe("a link to this site", () => {
    beforeEach(() => {
        findUnique.mockReset();
        readSettingStrings.mockReset();
    });

    it("unfurls with the site's mark when the page chose no picture", async () => {
        findUnique.mockResolvedValue(null);
        readSettingStrings.mockResolvedValue({ seo_default_og_image: "/icon-512.png" });

        const answer = await onPageMeta(EMPTY, asking(null));
        expect(answer.image).toBe("/icon-512.png");
    });

    it("leaves a page that chose its own picture alone", async () => {
        findUnique.mockResolvedValue(null);
        readSettingStrings.mockResolvedValue({ seo_default_og_image: "/icon-512.png" });

        const answer = await onPageMeta(EMPTY, asking("/covers/patch.png"));
        // Unchanged, not merely equal: core keeps what it built when nothing
        // here has an opinion.
        expect(answer).toBe(EMPTY);
    });

    it("gives the operator's own choice for this path the last word", async () => {
        findUnique.mockResolvedValue({
            metaTitle: "Our shop", metaDescription: null, ogTitle: null, ogDescription: null,
            ogImage: "/shop-card.png", canonical: null, keywords: null, noIndex: false, noFollow: false,
        });
        readSettingStrings.mockResolvedValue({ seo_default_og_image: "/icon-512.png" });

        const answer = await onPageMeta(EMPTY, asking("/covers/patch.png"));
        expect(answer.image).toBe("/shop-card.png");
        expect(answer.title).toBe("Our shop");
    });

    it("says nothing when there is no mark and no page picture", async () => {
        findUnique.mockResolvedValue(null);
        readSettingStrings.mockResolvedValue({});

        const answer = await onPageMeta(EMPTY, asking(null));
        expect(answer).toBe(EMPTY);
    });
});
