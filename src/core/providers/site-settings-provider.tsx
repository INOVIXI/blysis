"use client";

import { useState, type ReactNode } from "react";
import { ServedSiteSettingsContext, seedSiteSettings, type SettingsPayload } from "@/core/hooks/useSiteSettings";

interface SiteSettingsProviderProps {
    /** Null when the layout could not read them; the hook then fetches. */
    payload: SettingsPayload | null;
    children: ReactNode;
}

/**
 * The public site settings, handed down from the root layout.
 *
 * The layout reads them on the server and passes plain data, so
 * `useSiteSettings` starts from the same values when the server draws the
 * page and when the browser hydrates it. Starting from the browser's own cache
 * instead drew the shipped name on the server and the operator's in the
 * browser, which React reports as a hydration mismatch.
 */
export function SiteSettingsProvider({ payload, children }: SiteSettingsProviderProps) {
    // Once per mount, before any child asks; `seedShared` does nothing on
    // the server, where the store outlives the request.
    useState(() => {
        if (payload) seedSiteSettings(payload);
    });
    return <ServedSiteSettingsContext value={payload}>{children}</ServedSiteSettingsContext>;
}
