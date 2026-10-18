"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { themeRegistry, defaultThemeId as REGISTRY_DEFAULT } from "@/core/generated/theme-registry";
import { ThemeConfigProvider } from "@/core/lib/theme-config-client";
import type { ThemeManifest } from "@/core/lib/theme-manifest-schema";
import { applyOverrides } from "@/core/components/admin/theme-customizer/diff";
import { resolveMode, resolvePageMode, SYSTEM_MODE, type Surface } from "@/core/lib/theme-mode";
import {
    ADMIN_COLOR_MODE_COOKIE,
    COLOR_MODE_COOKIE,
    COLOR_MODE_MAX_AGE,
    SYSTEM_SCHEME_COOKIE,
} from "@/core/lib/color-mode";

interface ThemeContextType {
    activeTheme: ThemeManifest | null;
    currentThemeId: string;
    currentMode: string;
    /** Draw this page in a mode, for now. The customizer previews with it; it saves nothing. */
    setMode: (mode: string) => void;
    /** Work the page's mode out again from the choices stored - after a toggle wrote one. */
    refreshMode: () => void;
    surface: Surface;
    /** The site's own default: a mode of the theme, or `system`. */
    siteDefault: string;
    /** The site holds its mode, so it offers visitors no toggle. */
    locked: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
    activeTheme: null,
    currentThemeId: REGISTRY_DEFAULT,
    currentMode: "light",
    setMode: () => {},
    refreshMode: () => {},
    surface: "site",
    siteDefault: "light",
    locked: false,
});
export const useTheme = () => useContext(ThemeContext);

interface AppThemeProviderProps {
    children: ReactNode;
    themeId: string;
    mode: string;
    surface?: Surface;
    siteDefault?: string;
    locked?: boolean;
    serverConfig?: Record<string, unknown>;
}

function readCookie(name: string): string | null {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemScheme(): "light" | "dark" {
    return window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

function pickTheme(id: string): ThemeManifest {
    return themeRegistry[id] ?? themeRegistry[REGISTRY_DEFAULT] ?? Object.values(themeRegistry)[0];
}

export function AppThemeProvider({
    children, themeId, mode, surface = "site", siteDefault, locked = false, serverConfig,
}: AppThemeProviderProps) {
    const activeTheme = useMemo(() => pickTheme(themeId), [themeId]);
    // `mode` is what the server already resolved, visitor's cookie included,
    // and it is on `<html>` before this runs. Resolving again only guards a
    // theme switch that leaves a mode this theme does not have.
    const [currentMode, setCurrentMode] = useState<string>(() =>
        resolveMode({ manifest: activeTheme, forced: mode })
    );

    // `mode` is a dependency although it is not read. `<html data-mode>` is
    // also written by the layout, and a route refresh patches it with what the
    // server resolved when the refresh was asked for - before a choice made a
    // moment later, which `currentMode` already holds and so does not change.
    // Without it the panel's button said "light" over a dark page.
    useEffect(() => {
        if (typeof document === "undefined") return;
        document.documentElement.setAttribute("data-theme", activeTheme.id);
        document.documentElement.setAttribute("data-mode", currentMode);
    }, [activeTheme, currentMode, mode]);

    const defaultMode = siteDefault ?? activeTheme.modes.default;

    // The same resolution the server made, from what the browser holds now:
    // both choices, the lock, and what the reader's system prefers.
    const refreshMode = useCallback(() => {
        setCurrentMode(resolvePageMode({
            manifest: activeTheme,
            surface,
            siteDefault: defaultMode,
            locked,
            siteCookie: readCookie(COLOR_MODE_COOKIE),
            adminCookie: readCookie(ADMIN_COLOR_MODE_COOKIE),
            systemScheme: systemScheme(),
        }));
    }, [activeTheme, surface, defaultMode, locked]);

    // A saved change to the site's mode or its lock reaches here as new props
    // when the panel refreshes the route, and the page is drawn again from
    // them. On the first render this agrees with the server and changes nothing.
    useEffect(() => { refreshMode(); }, [refreshMode]);

    // A site that follows the reader's system. Chromium told the server which
    // way it leans; other browsers can only be asked here, so the first page
    // they are sent may be in the wrong mode. It is corrected now, and the
    // answer is kept so the next page arrives right. A system that changes
    // its mind while the page is open is followed too.
    useEffect(() => {
        if (defaultMode !== SYSTEM_MODE || typeof window === "undefined" || !window.matchMedia) return;
        const remember = () => {
            document.cookie = `${SYSTEM_SCHEME_COOKIE}=${systemScheme()}; path=/; max-age=${COLOR_MODE_MAX_AGE}; samesite=lax`;
            refreshMode();
        };
        remember();
        const query = window.matchMedia(DARK_QUERY);
        query.addEventListener("change", remember);
        return () => query.removeEventListener("change", remember);
    }, [defaultMode, refreshMode]);

    // A choice made in another tab. The toggles write localStorage only so
    // that this event fires; the cookie is what is read.
    useEffect(() => {
        if (typeof window === "undefined") return;
        const onStorage = (event: StorageEvent) => {
            if (event.key === COLOR_MODE_COOKIE || event.key === ADMIN_COLOR_MODE_COOKIE) refreshMode();
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, [refreshMode]);

    // Live preview channel - customizer iframe gets overrides via postMessage.
    // Same-origin check on receive; wildcard NEVER used for postMessage target.
    const [previewOverrides, setPreviewOverrides] = useState<Record<string, unknown> | null>(null);
    useEffect(() => {
        if (typeof window === "undefined") return;
        if (window.parent === window) return;
        const handler = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type === "blysis:theme-preview" && typeof event.data.overrides === "object") {
                setPreviewOverrides(event.data.overrides as Record<string, unknown>);
            }
        };
        window.addEventListener("message", handler);
        try { window.parent.postMessage({ type: "blysis:preview-ready" }, window.location.origin); }
        catch { /* cross-origin / detached - ignore */ }
        return () => window.removeEventListener("message", handler);
    }, []);

    const effectiveConfig = useMemo<Record<string, unknown>>(
        () => previewOverrides ? applyOverrides(serverConfig ?? {}, previewOverrides) : (serverConfig ?? {}),
        [serverConfig, previewOverrides],
    );

    // It wrote a `blysis_mode` cookie, which nothing has ever read: the mode a
    // page is drawn in is chosen by the toggles, and the site's default is
    // saved on the server. All this does is draw the page in a mode for now.
    const setMode = useCallback((next: string) => {
        if (activeTheme.modes.available[next]) setCurrentMode(next);
    }, [activeTheme]);

    return (
        <ThemeContext.Provider value={{
            activeTheme, currentThemeId: activeTheme.id, currentMode, setMode, refreshMode,
            surface, siteDefault: defaultMode, locked,
        }}>
            <ThemeConfigProvider value={effectiveConfig}>{children}</ThemeConfigProvider>
        </ThemeContext.Provider>
    );
}
