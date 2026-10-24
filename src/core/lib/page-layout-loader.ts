import { cache } from "react";
import { ModuleBlocks } from "@/core/generated/module-registry";
import { CORE_BLOCKS } from "@/core/lib/core-blocks";
import { getModuleStates } from "@/core/lib/module-cache";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { readSettingValues } from "@/core/lib/setting-values";
import { getActiveTheme } from "@/core/lib/theme-state";
import { resolveLayout, type ResolvedLayout } from "@/core/lib/page-layout";

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
