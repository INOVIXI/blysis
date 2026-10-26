import { cache } from "react";
import { cookies, headers } from "next/headers";
import { prisma } from "./db";
import { invalidateTranslationCache } from "./i18n/translation-service";
import { resolvePageMode, type Surface } from "./theme-mode";
import {
    ADMIN_COLOR_MODE_COOKIE,
    COLOR_MODE_COOKIE,
    COLOR_MODE_LOCK_SETTING,
    SURFACE_HEADER,
    SYSTEM_SCHEME_COOKIE,
    SYSTEM_SCHEME_HINT,
} from "./color-mode";
import { themeRegistry, defaultThemeId } from "@/core/generated/theme-registry";
import type { ThemeManifest } from "./theme-manifest-schema";

interface RequestSignals {
    surface: Surface;
    siteCookie: string | null;
    adminCookie: string | null;
    systemScheme: "light" | "dark" | null;
}

const NO_REQUEST: RequestSignals = { surface: "site", siteCookie: null, adminCookie: null, systemScheme: null };

/**
 * What this request says about the mode: which surface it is, what the
 * visitor chose for the site and for the panel, and what their system
 * prefers.
 *
 * `cookies()` and `headers()` throw rather than reject when they are called
 * with no request around them, so the guard has to be a `try` and not a
 * `.catch` on the promise. A cron, a script and a test all reach this
 * function and none of them is a person with a preference; they get the
 * site's mode.
 */
async function requestSignals(): Promise<RequestSignals> {
    try {
        const [jar, head] = await Promise.all([cookies(), headers()]);
        // The hint is fresh on every Chromium request; the cookie is what the
        // page last saw in a browser that sends no hint.
        const scheme = head.get(SYSTEM_SCHEME_HINT) ?? jar.get(SYSTEM_SCHEME_COOKIE)?.value ?? null;
        return {
            surface: head.get(SURFACE_HEADER) === "admin" ? "admin" : "site",
            siteCookie: jar.get(COLOR_MODE_COOKIE)?.value ?? null,
            adminCookie: jar.get(ADMIN_COLOR_MODE_COOKIE)?.value ?? null,
            systemScheme: scheme === "dark" || scheme === "light" ? scheme : null,
        };
    } catch {
        return NO_REQUEST;
    }
}

/** A query that fails, or a client that lacks the model, reads as no rows. */
async function soft<T>(query: () => Promise<T>, fallback: T): Promise<T> {
    try {
        return await query();
    } catch {
        return fallback;
    }
}

export interface ActiveTheme {
    themeId: string;
    /** The mode this page is drawn in: the panel's or the site's, as resolved. */
    mode: string;
    manifest: ThemeManifest;
    /** The operator's colour customization for `mode`. */
    tokenOverrides: Record<string, unknown>;
    /**
     * Every mode's customization, so a page that changes mode without a
     * reload - the toggle, the panel following the site, the reader's system
     * changing - is drawn in that mode's colours and not the theme's defaults.
     */
    overridesByMode: Record<string, Record<string, unknown>>;
    settings: Record<string, Record<string, unknown>>;
    /** Which surface this request is: the public site or the admin panel. */
    surface: Surface;
    /** `ThemeState.mode`: a mode of the theme, or `system`. */
    siteDefault: string;
    /** The site holds its mode: no visitor toggle, and an old choice ignored. */
    locked: boolean;
}

/**
 * Resolve the active theme + mode from DB, merged with any customization
 * overrides and theme-owned settings.
 *
 * Four queries, and the layout is not the only caller: an admin page asks
 * again inside the layout that already asked, which made it six. `cache`
 * deduplicates for one render, which is the window where the answer cannot
 * change; a theme switch is a mutation, so the next request reads it fresh.
 */
export const getActiveTheme = cache(async function getActiveTheme(): Promise<ActiveTheme> {
    const state = await prisma.themeState.findFirst().catch(() => null);
    const themeId = state?.themeId && themeRegistry[state.themeId] ? state.themeId : defaultThemeId;
    const manifest = themeRegistry[themeId] ?? themeRegistry[defaultThemeId];
    /*
     * The visitor's own choice, over the site's, over the theme's - and on
     * the panel, the panel's own choice first.
     *
     * Read here rather than in the layout so every caller in one request gets
     * the same answer, and so the customization below is fetched for the mode
     * the page is actually drawn in - it is keyed by mode, and fetching the
     * site's while rendering the visitor's handed a dark page the light
     * theme's colour overrides.
     */
    const [signals, lockRow, customizations, settingRows] = await Promise.all([
        requestSignals(),
        soft(() => prisma.setting.findUnique({ where: { key: COLOR_MODE_LOCK_SETTING } }), null),
        soft(() => prisma.themeCustomization.findMany({ where: { themeId } }), []),
        soft(() => prisma.themeSetting.findMany({ where: { themeId } }), []),
    ]);
    const siteDefault = state?.mode ?? manifest.modes.default;
    const locked = lockRow?.value === true;
    const mode = resolvePageMode({ manifest, siteDefault, locked, ...signals });

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

    const overridesByMode: Record<string, Record<string, unknown>> = {};
    for (const row of customizations) {
        if (row.overrides && typeof row.overrides === "object") {
            overridesByMode[row.mode] = row.overrides as Record<string, unknown>;
        }
    }
    const tokenOverrides = overridesByMode[mode] ?? {};

    return {
        themeId, mode, manifest, tokenOverrides, overridesByMode, settings,
        surface: signals.surface, siteDefault, locked,
    };
});

export async function setActiveTheme(themeId: string, mode: string): Promise<void> {
    await prisma.themeState.upsert({
        where: { id: 1 },
        create: { id: 1, themeId, mode },
        update: { themeId, mode },
    });
    // The catalogue carries the strings of the theme being worn and is held
    // for two minutes; kept, the theme just picked drew its own lines as
    // missing messages until it ran out.
    await invalidateTranslationCache();
}
