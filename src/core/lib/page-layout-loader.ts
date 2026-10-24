import { cache } from "react";
import { prisma } from "@/core/lib/db";
import { ModuleBlocks } from "@/core/generated/module-registry";
import { themeRegistry } from "@/core/generated/theme-registry";
import { getModuleStates } from "@/core/lib/module-cache";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { readSettingValues } from "@/core/lib/setting-values";
import { resolveLayout, type ResolvedLayout } from "@/core/lib/page-layout";

/**
 * The homepage's arrangement under one theme, read on the server so it is in
 * the first HTML and nothing moves once the page has painted.
 *
 * A database that cannot be reached is not a reason to draw no homepage: the
 * saved arrangement is then treated as absent and the theme's is drawn, and
 * the module states and widget settings fall back the way their own readers
 * do. `cache` keeps it to one read per render.
 */
export const loadHomeLayout = cache(async function loadHomeLayout(themeId: string): Promise<ResolvedLayout> {
    const [saved, states, settings] = await Promise.all([
        prisma.pageLayout
            .findUnique({ where: { page_themeId: { page: "home", themeId } }, select: { document: true } })
            .catch(() => null),
        getModuleStates(),
        readSettingValues(["widget_visibility", "widget_order"]).catch(() => ({})),
    ]);
    return resolveLayout({
        saved: saved?.document ?? null,
        themeDefault: themeRegistry[themeId]?.layouts?.home,
        blocks: ModuleBlocks,
        enabled: (module) => isEnabledIn(states, module),
        settings,
    });
});
