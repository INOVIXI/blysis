"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { themeRegistry, defaultThemeId as REGISTRY_DEFAULT } from "@/core/generated/theme-registry";
import { ThemeConfigProvider } from "@/core/lib/theme-config-client";
import type { ThemeManifest } from "@/core/lib/theme-manifest-schema";
import { applyOverrides } from "@/core/components/admin/theme-customizer/diff";
import { resolveMode } from "@/core/lib/theme-mode";

interface ThemeContextType {
    activeTheme: ThemeManifest | null;
    currentThemeId: string;
    currentMode: string;
    setMode: (mode: string) => void;
}

const ThemeContext = createContext<ThemeContextType>({
    activeTheme: null,
    currentThemeId: REGISTRY_DEFAULT,
    currentMode: "light",
    setMode: () => {},
});
export const useTheme = () => useContext(ThemeContext);

interface AppThemeProviderProps {
    children: ReactNode;
    themeId: string;
    mode: string;
    serverConfig?: Record<string, unknown>;
}

function pickTheme(id: string): ThemeManifest {
    return themeRegistry[id] ?? themeRegistry[REGISTRY_DEFAULT] ?? Object.values(themeRegistry)[0];
}

export function AppThemeProvider({ children, themeId, mode, serverConfig }: AppThemeProviderProps) {
    const activeTheme = useMemo(() => pickTheme(themeId), [themeId]);
    // `mode` is what the server already resolved, visitor's cookie included,
    // and it is on `<html>` before this runs. Resolving again only guards a
    // theme switch that leaves a mode this theme does not have.
    const [currentMode, setCurrentMode] = useState<string>(() =>
        resolveMode({ manifest: activeTheme, forced: mode })
    );

    useEffect(() => {
        if (typeof document === "undefined") return;
        document.documentElement.setAttribute("data-theme", activeTheme.id);
        document.documentElement.setAttribute("data-mode", currentMode);
    }, [activeTheme, currentMode]);

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

    const setMode = (next: string) => {
        if (activeTheme.modes.available[next]) {
            setCurrentMode(next);
            try { document.cookie = `blysis_mode=${next}; path=/; max-age=31536000; samesite=lax`; } catch { /* ignore cookie set failure */ }
        }
    };

    return (
        <ThemeContext.Provider value={{ activeTheme, currentThemeId: activeTheme.id, currentMode, setMode }}>
            <ThemeConfigProvider value={effectiveConfig}>{children}</ThemeConfigProvider>
        </ThemeContext.Provider>
    );
}
