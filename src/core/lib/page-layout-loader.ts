import { cache } from "react";
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
 * The arrangement itself is the theme's code; only the widget settings come
 * from the database. A database that cannot be reached is not a reason to
 * draw no homepage: the widget settings then count as unsaved, and the module
 * states fall back the way their own reader does. `cache` keeps it to one
 * read per render.
 */
export const loadHomeLayout = cache(async function loadHomeLayout(themeId: string): Promise<ResolvedLayout> {
    const [states, settings] = await Promise.all([
        getModuleStates(),
        readSettingValues(["widget_visibility", "widget_order"]).catch(() => ({})),
    ]);
    return resolveLayout({
        themeLayout: themeRegistry[themeId]?.layouts?.home,
        blocks: ModuleBlocks,
        enabled: (module) => isEnabledIn(states, module),
        settings,
    });
});
