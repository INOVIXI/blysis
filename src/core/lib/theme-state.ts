import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { resolveMode } from "./theme-mode";
import { COLOR_MODE_COOKIE } from "./color-mode";
import { themeRegistry, defaultThemeId } from "@/core/generated/theme-registry";
import type { ThemeManifest } from "./theme-manifest-schema";

/**
 * The visitor's own mode, or null where there is no visitor.
 *
 * `cookies()` throws rather than rejects when it is called with no request
 * around it, so the guard has to be a `try` and not a `.catch` on the
 * promise. A cron, a script and a test all reach this function and none of
 * them is a person with a preference; they get the site's mode.
 */
async function visitorMode(): Promise<string | null> {
    try {
        return (await cookies()).get(COLOR_MODE_COOKIE)?.value ?? null;
    } catch {
        return null;
    }
}

export interface ActiveTheme {
    themeId: string;
    mode: string;
    manifest: ThemeManifest;
    tokenOverrides: Record<string, unknown>;
    settings: Record<string, Record<string, unknown>>;
}

/**
 * Resolve the active theme + mode from DB, merged with any customization
 * overrides and theme-owned settings.
 *
 * Three queries, and the layout is not the only caller: an admin page asks
 * again inside the layout that already asked, which made it six. `cache`
 * deduplicates for one render, which is the window where the answer cannot
 * change; a theme switch is a mutation, so the next request reads it fresh.
 */
export const getActiveTheme = cache(async function getActiveTheme(): Promise<ActiveTheme> {
    const state = await prisma.themeState.findFirst().catch(() => null);
    const themeId = state?.themeId && themeRegistry[state.themeId] ? state.themeId : defaultThemeId;
    const manifest = themeRegistry[themeId] ?? themeRegistry[defaultThemeId];
    /*
     * The visitor's own choice, over the site's, over the theme's.
     *
     * Read here rather than in the layout so every caller in one request gets
     * the same answer, and so the customization below is fetched for the mode
     * the page is actually drawn in - it is keyed by mode, and fetching the
     * site's while rendering the visitor's handed a dark page the light
     * theme's colour overrides.
     */
    const chosen = await visitorMode();
    const mode = resolveMode({ manifest, cookie: chosen, siteDefault: state?.mode ?? null });

    const [customization, settingRows] = await Promise.all([
        prisma.themeCustomization.findUnique({ where: { themeId_mode: { themeId, mode } } }).catch(() => null),
        prisma.themeSetting.findMany({ where: { themeId } }).catch(() => []),
    ]);

    // Start every declared settings group + field at its manifest-level
    // `default`. DB rows then override - so a theme that ships with field
    // defaults renders them immediately on first install, before the admin
    // has saved anything. Without this step, any component reading
    // useThemeConfig()?.hero?.title on a freshly-switched theme sees
    // undefined and degrades to nothing visible.
    const settings: Record<string, Record<string, unknown>> = {};
    for (const [groupKey, groupDef] of Object.entries(manifest.settings ?? {})) {
        const group: Record<string, unknown> = {};
        for (const [fieldKey, fieldDef] of Object.entries(groupDef.fields)) {
            if ("default" in fieldDef && fieldDef.default !== undefined) {
                group[fieldKey] = fieldDef.default;
            }
        }
        if (Object.keys(group).length > 0) settings[groupKey] = group;
    }
    for (const row of settingRows) {
        if (!settings[row.groupKey]) settings[row.groupKey] = {};
        settings[row.groupKey][row.key] = row.value;
    }

    const tokenOverrides = (customization?.overrides && typeof customization.overrides === "object"
        ? (customization.overrides as Record<string, unknown>)
        : {});

    return { themeId, mode, manifest, tokenOverrides, settings };
});

export async function setActiveTheme(themeId: string, mode: string): Promise<void> {
    await prisma.themeState.upsert({
        where: { id: 1 },
        create: { id: 1, themeId, mode },
        update: { themeId, mode },
    });
}
