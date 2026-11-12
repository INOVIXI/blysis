"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { sharedJson, peekShared, invalidateShared, seedShared } from "@/core/lib/shared-request";

/**
 * Public site settings, fetched once per page however many components ask.
 *
 * The deduplication used to live in a module-level variable here, which held
 * until code splitting put a second copy of this file on the homepage. Each
 * copy had its own "in flight" variable, so the navbar, the footer, the
 * currency selector and the homepage between them fetched the same settings
 * five times. The shared store hangs off `globalThis`, so every copy finds
 * the same entry.
 */
const SETTINGS_URL = "/api/v1/public-settings";

export interface SettingsPayload {
    settings?: Record<string, unknown>;
    cacheSeconds?: number;
}

/**
 * The server states how long it considers the payload fresh
 * (Admin > Settings > General). A minute when it says nothing.
 */
function freshness(payload: SettingsPayload): number {
    const seconds = payload.cacheSeconds;
    return typeof seconds === "number" && seconds > 0 ? seconds * 1000 : 60_000;
}

/**
 * What the root layout read on the server, through `SiteSettingsProvider`.
 * Null outside it: the error pages render above the root layout, and there
 * the hook falls back to fetching.
 */
export const ServedSiteSettingsContext = createContext<SettingsPayload | null>(null);

/**
 * Put what the server read into the browser's cache, so the first fetch is
 * not made for an answer the page already carries. Called once, when the
 * root layout's provider mounts: seeding on every render would put the
 * page's copy back after an admin save had dropped it on purpose.
 */
export function seedSiteSettings(payload: SettingsPayload): void {
    seedShared(SETTINGS_URL, payload, freshness(payload));
}

/** Invalidate the settings cache so the next useSiteSettings call fetches fresh data */
export function invalidateSettingsCache() {
    invalidateShared(SETTINGS_URL);
}

export function useSiteSettings() {
    // Render what is already known on the first pass. Waiting a tick for a
    // value we are holding costs a blank frame, and the footer moving after
    // that frame is what a visitor sees as the page jumping.
    //
    // What the server read comes first, even over a newer answer in the
    // browser's cache: the first pass in the browser is hydration, and it has
    // to draw what the server drew. A boundary that hydrated after another
    // component's fetch had landed drew the newer answer, and React logged a
    // mismatch on every page. The effect below brings the newer one in after.
    // `tests/unit/the-sites-name-is-the-same-on-both-sides.test.tsx`.
    const served = useContext(ServedSiteSettingsContext);
    const known = served ?? peekShared<SettingsPayload>(SETTINGS_URL);
    const [settings, setSettings] = useState<Record<string, unknown>>(known?.settings ?? {});
    const [loaded, setLoaded] = useState(known !== undefined);

    useEffect(() => {
        sharedJson<SettingsPayload>(SETTINGS_URL, freshness)
            .then((payload) => {
                setSettings(payload.settings || {});
                setLoaded(true);
            })
            .catch((err) => {
                console.error("[useSiteSettings]", err);
            });
    }, []);

    return { settings, loaded };
}
