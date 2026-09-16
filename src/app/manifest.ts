import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";
import { readSettingValues } from "@/core/lib/setting-values";
import { SITE_LOGO_KEY, siteLogo } from "@/core/lib/site-logo";

/**
 * What a phone shows when somebody adds this site to their home screen.
 *
 * It was `public/manifest.json`, a static file with the product's own name,
 * short name and description written into it. So every installation on earth
 * put the same word under the same icon, whatever the operator had called
 * their site - the one place `SiteName` could not reach, because a manifest
 * is not a React tree.
 *
 * The icons stay the shipped ones unless a logo is set. A home screen icon is
 * a square raster at two sizes and an operator's logo is whatever they
 * uploaded, so it is offered rather than substituted: a site with a logo gets
 * it, a site without keeps the icons that ship.
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
    const [settings, t] = await Promise.all([
        readSettingValues(["site_name", "site_description", SITE_LOGO_KEY]),
        getTranslations("common"),
    ]);
    // The shipped name comes from the catalogue, the way `SiteName` reads it:
    // a literal here would be the product's name written into an
    // installation's own file again, which is the thing this route exists to
    // stop.
    const name = typeof settings.site_name === "string" && settings.site_name.trim()
        ? settings.site_name.trim()
        : t("appName");
    const description = typeof settings.site_description === "string"
        ? settings.site_description.trim()
        : "";
    const logo = siteLogo(settings[SITE_LOGO_KEY]);

    return {
        name,
        short_name: name,
        ...(description ? { description } : {}),
        start_url: "/",
        display: "standalone",
        background_color: "#f3f4f6",
        theme_color: "#2563eb",
        orientation: "portrait-primary",
        icons: logo
            ? [{ src: logo, sizes: "any", type: "image/png" }]
            : [
                { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
                { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
            ],
    };
}
