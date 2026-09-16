import type { ModuleSeed } from "@/core/sdk/seed";

/**
 * The share image every page falls back to.
 *
 * Without one no page on the site carries an `og:image` at all, so a link
 * posted anywhere unfurls as a bare line of text. The site's own mark is the
 * honest default: it is square, which is why core draws the small card for it
 * rather than stretching it across a 2:1 banner.
 *
 * Written only when the operator has said nothing, and not through `create`:
 * a setting is not a demo row, and `--clean` taking the site's share image
 * away with the fake orders would be a surprise.
 */
const SHARE_IMAGE = "/icon-512.png";

export const seed: ModuleSeed = {
    run: async (ctx) => {
        const key = "seo_default_og_image";
        const existing = await ctx.prisma.setting.findUnique({ where: { key } });
        const current = typeof existing?.value === "string" ? existing.value.trim() : "";
        if (current) {
            ctx.log("share image already set");
            return;
        }
        await ctx.prisma.setting.upsert({
            where: { key },
            update: { value: SHARE_IMAGE, module: "seo" },
            create: { key, value: SHARE_IMAGE, module: "seo" },
        });
        ctx.log(`share image ${SHARE_IMAGE}`);
    },
};
