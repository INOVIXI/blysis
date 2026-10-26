import type { PlaceholderSource } from "@/core/lib/placeholders";

/**
 * Core's own site placeholders, under the `site` namespace no module id can
 * take. Declared here as a module declares its own in `module.json`, and read
 * through the same resolver.
 */
export const CORE_PLACEHOLDERS: PlaceholderSource[] = [
    {
        name: "site.name",
        module: "core",
        labelKey: "placeholder_site_name",
        example: null,
        maxAgeSeconds: 300,
        loader: async () => ({
            default: async () => (await import("@/core/lib/seo")).getSeoSiteInfo().then((info) => info.siteName),
        }),
    },
];
