/**
 * The override an operator set for this page, handed back to core.
 *
 * Core builds a page's head out of what the page itself declared and then asks
 * this question once, with the path. That is the only way an override can
 * reach a crawler: this module cannot export `generateMetadata` for pages it
 * does not own, and what it did instead was rewrite `document.head` after the
 * page had loaded. A crawler reads the server's HTML and never ran the script,
 * so every override set on this screen was invisible to the thing it was set
 * for, while looking perfectly applied in a browser.
 *
 * Three tiers, in order: what was set for this path, what the page says about
 * itself, what the site falls back to. Core hands the middle tier over in the
 * context, which is what makes the third one safe - a site-wide share image
 * has to lose to the image a page chose, and without knowing whether the page
 * chose one this could only ever always win or never apply.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma, readSettingStrings } from "@/core/sdk/server";

const onPageMeta: HookHandlerFor<"seo.pageMeta", "filter"> = async (meta, context) => {
    const [row, settings] = await Promise.all([
        prisma.seoPage.findUnique({ where: { path: context.path } }),
        readSettingStrings(["seo_default_og_image"]),
    ]);

    const shareImage = row?.ogImage || context.image || settings.seo_default_og_image || null;
    if (!row) {
        // Nothing has been said about this page. The site-wide share image
        // still applies: without it no page on the site carries an og:image
        // at all, and a link to it unfurls as a bare line of text.
        return shareImage === context.image ? meta : { ...meta, image: shareImage };
    }

    return {
        title: row.metaTitle || null,
        description: row.metaDescription || null,
        ogTitle: row.ogTitle || null,
        ogDescription: row.ogDescription || null,
        image: shareImage,
        canonical: row.canonical || null,
        keywords: row.keywords || null,
        noIndex: row.noIndex,
        noFollow: row.noFollow,
    };
};

export default onPageMeta;
