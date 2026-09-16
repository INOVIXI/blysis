/**
 * The site's own head: how a page's name is framed, and who owns the domain.
 *
 * These four settings were written to the database by the screen above and
 * read by nothing at all. An operator who pasted the token Google Search
 * Console gave them, pressed save and saw "SEO settings saved" had verified
 * nothing: the tag never reached a page. The title template was the same
 * story, so a site could not put its name in front of a page's own.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { readSettingStrings } from "@/core/sdk/server";

const onSiteHead: HookHandlerFor<"seo.siteHead", "filter"> = async (head) => {
    const settings = await readSettingStrings([
        "seo_title_template",
        "seo_keywords",
        "seo_google_verification",
        "seo_bing_verification",
    ]);

    return {
        ...head,
        titleTemplate: settings.seo_title_template || head.titleTemplate,
        keywords: settings.seo_keywords || head.keywords,
        googleVerification: settings.seo_google_verification || head.googleVerification,
        bingVerification: settings.seo_bing_verification || head.bingVerification,
    };
};

export default onSiteHead;
