"use client";

import { useState, useEffect, useCallback } from "react";
import { ADMIN_COLOR_MODE_COOKIE, COLOR_MODE_COOKIE, COLOR_MODE_MAX_AGE } from "@/core/lib/color-mode";
import { FOLLOW_SITE } from "@/core/lib/theme-mode";
import { useTheme } from "@/core/providers/theme-provider";

/**
 * Write one of the mode choices, and tell the site's other open tabs.
 *
 * The choice is a **cookie**, because the server renders `data-mode` from it
 * and a page that arrives in the right mode never flashes into it. See
 * `color-mode.ts`.
 *
 * `localStorage` is written too, and only for one reason: it is what raises a
 * `storage` event in the site's other open tabs. Nothing reads it back as a
 * preference, so the two cannot disagree about anything that matters.
 */
function writeChoice(cookie: string, value: string) {
    document.cookie = `${cookie}=${value}; path=/; max-age=${COLOR_MODE_MAX_AGE}; samesite=lax`;
    try { localStorage.setItem(cookie, value); } catch { /* private mode */ }
}

/**
 * The site's light/dark toggle.
 *
 * It used to be the panel's toggle as well, both writing `color-mode`, so the
 * panel's moon made the site dark. The panel has its own now - see
 * `usePanelMode`. A site that holds its mode offers no toggle at all, which
 * is what `locked` is for.
 */
export function useDarkMode() {
    const { currentMode, refreshMode, locked } = useTheme();
    const isDark = currentMode === "dark";

    const toggle = useCallback(() => {
        writeChoice(COLOR_MODE_COOKIE, isDark ? "light" : "dark");
        refreshMode();
    }, [isDark, refreshMode]);

    return { isDark, toggle, locked };
}

export type PanelChoice = "site" | "light" | "dark";

/** The order the panel's button steps through. */
const PANEL_CHOICES: PanelChoice[] = [FOLLOW_SITE, "light", "dark"];

/**
 * The panel's own mode: light, dark, or the same as the site.
 *
 * "The same as the site" is the default and the old behaviour - the panel is
 * drawn in whatever the site would be drawn in for this reader - so nobody
 * who liked it has anything to undo.
 */
export function usePanelMode() {
    const { currentMode, refreshMode } = useTheme();
    // The cookie is not readable on the server render of a client component's
    // first pass, so the choice is learned after mount; the icon follows the
    // mode, which the server did know.
    const [choice, setChoice] = useState<PanelChoice>(FOLLOW_SITE);

    useEffect(() => {
        const stored = document.cookie.match(new RegExp(`(?:^|; )${ADMIN_COLOR_MODE_COOKIE}=([^;]*)`))?.[1];
        if (stored === "light" || stored === "dark") setChoice(stored);
    }, []);

    const cycle = useCallback(() => {
        const next = PANEL_CHOICES[(PANEL_CHOICES.indexOf(choice) + 1) % PANEL_CHOICES.length];
        writeChoice(ADMIN_COLOR_MODE_COOKIE, next);
        setChoice(next);
        refreshMode();
    }, [choice, refreshMode]);

    return { choice, isDark: currentMode === "dark", cycle };
}
