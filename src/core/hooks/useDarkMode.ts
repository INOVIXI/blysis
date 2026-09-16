"use client";

import { useState, useEffect, useCallback } from "react";
import { COLOR_MODE_COOKIE, COLOR_MODE_MAX_AGE } from "@/core/lib/color-mode";

/**
 * The light/dark toggle, and the one place the choice is written.
 *
 * The choice is a **cookie**, because the server renders `data-mode` from it
 * and a page that arrives in the right mode never flashes into it. See
 * `color-mode.ts`.
 *
 * `localStorage` is written too, and only for one reason: it is what raises a
 * `storage` event in the site's other open tabs. Nothing reads it back as a
 * preference, so the two cannot disagree about anything that matters.
 */
export function useDarkMode() {
    const [isDark, setIsDark] = useState(false);

    useEffect(() => {
        // Read initial state from the DOM, which the server wrote.
        const dark = document.documentElement.getAttribute("data-mode") === "dark";
         
        setIsDark(dark);

        // Listen for changes from other components/tabs
        const handleStorage = (e: StorageEvent) => {
            if (e.key === COLOR_MODE_COOKIE && e.newValue) {
                setIsDark(e.newValue === "dark");
                document.documentElement.setAttribute("data-mode", e.newValue);
            }
        };

        // Listen for custom event (same-tab sync)
        const handleCustom = () => {
            setIsDark(document.documentElement.getAttribute("data-mode") === "dark");
        };

        window.addEventListener("storage", handleStorage);
        window.addEventListener("darkmode-change", handleCustom);
        return () => {
            window.removeEventListener("storage", handleStorage);
            window.removeEventListener("darkmode-change", handleCustom);
        };
    }, []);

    const toggle = useCallback(() => {
        const next = isDark ? "light" : "dark";
        setIsDark(next === "dark");
        // Removing the attribute is not the same as choosing light: a theme
        // whose own default is dark would go back to dark on the next paint.
        document.documentElement.setAttribute("data-mode", next);
        document.cookie =
            `${COLOR_MODE_COOKIE}=${next}; path=/; max-age=${COLOR_MODE_MAX_AGE}; samesite=lax`;
        try { localStorage.setItem(COLOR_MODE_COOKIE, next); } catch { /* private mode */ }
        // Notify other components in the same tab
        window.dispatchEvent(new Event("darkmode-change"));
    }, [isDark]);

    return { isDark, toggle };
}
