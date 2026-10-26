import prisma from "@/core/lib/db";
import { type SiteLanguages, siteLanguagesOf } from "./site-languages";

/**
 * The languages this site offers, as its settings say, for the proxy and the
 * server pages that publish them.
 *
 * Asked on every page request, so it is held for five seconds in a cache on
 * `globalThis`, which the proxy and the route that saves it share, as
 * `maintenance.ts` does; saving clears it. A database that cannot be read
 * offers every language rather than none, so a fault never takes the site
 * out of the language a visitor is reading.
 */

/** Which languages the site offers: an array of codes, in any order. */
export const SITE_LANGUAGES_KEY = "site_languages";
/** Which one it opens in. Written by the setup wizard since the first release. */
export const DEFAULT_LOCALE_KEY = "default_locale";

const TTL_MS = 5_000;
const GLOBAL_KEY = "__blysis_site_languages__" as const;

interface Held {
    value: SiteLanguages | null;
    at: number;
}

function held(): Held {
    const g = globalThis as unknown as Record<string, Held | undefined>;
    g[GLOBAL_KEY] ??= { value: null, at: 0 };
    return g[GLOBAL_KEY];
}

export async function getSiteLanguages(): Promise<SiteLanguages> {
    const cache = held();
    if (cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
    try {
        const rows = await prisma.setting.findMany({
            where: { key: { in: [SITE_LANGUAGES_KEY, DEFAULT_LOCALE_KEY] } },
            select: { key: true, value: true },
        });
        const of = (key: string) => rows.find((row) => row.key === key)?.value;
        const value = siteLanguagesOf(of(SITE_LANGUAGES_KEY), of(DEFAULT_LOCALE_KEY));
        cache.value = value;
        cache.at = Date.now();
        return value;
    } catch {
        return siteLanguagesOf(undefined, undefined);
    }
}

export function invalidateSiteLanguages(): void {
    const cache = held();
    cache.value = null;
    cache.at = 0;
}
