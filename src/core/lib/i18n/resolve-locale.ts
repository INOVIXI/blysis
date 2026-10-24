import { cookies, headers } from "next/headers";
import { locales, defaultLocale, type Locale } from "./config";

/** True when `value` is one of the locales this site serves. */
export function isKnownLocale(value: unknown): value is Locale {
    return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/**
 * Which language to answer in when the `[locale]` segment is not available.
 *
 * The not-found pages are rendered outside the route that carries the
 * segment, so they have to ask another way. The cookie first: next-intl
 * writes it exactly when the visitor's choice differs from what their browser
 * asked for, which is the case where the header would give the wrong answer.
 * Then the header, then the site default.
 */
export async function resolveLocaleFromRequest(): Promise<Locale> {
    const cookie = (await cookies()).get("NEXT_LOCALE")?.value;
    if (isKnownLocale(cookie)) return cookie;

    const accept = (await headers()).get("accept-language") ?? "";
    for (const part of accept.split(",")) {
        const tag = part.split(";")[0].trim().toLowerCase();
        if (isKnownLocale(tag)) return tag;
        const base = tag.split("-")[0];
        if (isKnownLocale(base)) return base;
    }
    return defaultLocale;
}

/**
 * The three strings a not-found page renders, read straight from the
 * translation service because no provider is mounted this far out.
 */
export async function notFoundStrings(locale: Locale): Promise<{
    title: string;
    description: string;
    goHome: string;
    search: string;
}> {
    const fallback = { title: "Page not found", description: "", goHome: "Go home", search: "Search the site" };
    try {
        const { getMessages } = await import("./translation-service");
        const messages = await getMessages(locale);
        const ns = (messages.notFound ?? {}) as Record<string, unknown>;
        const pick = (key: keyof typeof fallback) =>
            typeof ns[key] === "string" && ns[key] ? (ns[key] as string) : fallback[key];
        return { title: pick("title"), description: pick("description"), goHome: pick("goHome"), search: pick("search") };
    } catch {
        // A 404 has to render even when the database is the reason for it.
        return fallback;
    }
}
