"use client";

import { useMemo } from "react";
import { findPage } from "@/core/lib/arrangeable-pages";
import { resolvePageLayout, type ResolvedPageLayout } from "@/core/lib/page-layout";
import { useThemeSettings } from "@/core/lib/theme-config-client";
import { useTheme } from "@/core/providers/theme-provider";

/**
 * One page arranged under the active theme, in the browser, as
 * `loadPageLayout` arranges it on the server: the theme's arrangement for it,
 * else the page's own. Null for a page nothing declares.
 *
 * The browser already holds every theme's manifest and the active one's
 * settings, so a page drawn here asks nothing more of the server and does not
 * move once it has painted.
 */
export function usePageLayout(pageId: string): ResolvedPageLayout | null {
    const { activeTheme } = useTheme();
    const settings = useThemeSettings();
    const themeLayout = activeTheme?.layouts?.[pageId];
    return useMemo(() => {
        const page = findPage(pageId);
        if (!page) return null;
        return resolvePageLayout({ page, themeLayout, themeSettings: settings });
    }, [pageId, themeLayout, settings]);
}
