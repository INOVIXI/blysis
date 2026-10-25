import { cache } from "react";
import { ModuleBlocks } from "@/core/generated/module-registry";
import { findPage } from "@/core/lib/arrangeable-pages";
import { CORE_BLOCKS } from "@/core/lib/core-blocks";
import { getModuleStates } from "@/core/lib/module-cache";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { readSettingValues } from "@/core/lib/setting-values";
import { getActiveTheme } from "@/core/lib/theme-state";
import { resolveLayout, resolvePageLayout, type ResolvedLayout, type ResolvedPageLayout } from "@/core/lib/page-layout";

/**
 * The homepage's arrangement under the active theme, read on the server so it is in
 * the first HTML and nothing moves once the page has painted.
 *
 * The arrangement itself is the theme's code; only the widget settings come
 * from the database. A database that cannot be reached is not a reason to
 * draw no homepage: the widget settings then count as unsaved, and the module
 * states fall back the way their own reader does. `cache` keeps it to one
 * read per render.
 */
export const loadHomeLayout = cache(async function loadHomeLayout(): Promise<ResolvedLayout> {
    const [theme, states, settings] = await Promise.all([
        getActiveTheme(),
        getModuleStates(),
        readSettingValues(["widget_visibility", "widget_order"]).catch(() => ({})),
    ]);
    return resolveLayout({
        themeLayout: theme.manifest.layouts?.home,
        themeSettings: theme.settings,
        blocks: [...CORE_BLOCKS, ...ModuleBlocks],
        // Core's own blocks belong to no module, so nothing switches them off.
        enabled: (module) => module === "core" || isEnabledIn(states, module),
        settings,
    });
});

/**
 * One of core's or a module's pages, arranged under the active theme: the
 * theme's arrangement for it, else the page's own. Null for a page nothing
 * declares: a module asking under a name its manifest does not declare, or a
 * module whose pages were never generated.
 */
export const loadPageLayout = cache(async function loadPageLayout(pageId: string): Promise<ResolvedPageLayout | null> {
    const page = findPage(pageId);
    if (!page) return null;
    const theme = await getActiveTheme();
    return resolvePageLayout({
        page,
        themeLayout: theme.manifest.layouts?.[pageId],
        themeSettings: theme.settings,
    });
});
