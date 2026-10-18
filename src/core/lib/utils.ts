import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with clsx
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Format currency
 */
export function formatCurrency(
    amount: number,
    currency = "USD",
    locale = "en-US"
): string {
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
    }).format(amount);
}

/**
 * Strip every HTML tag, leaving the text.
 *
 * Two places did this with a one-line `replace`: the suggestions list, which
 * shows a plain-text preview of a rich-text body, and the module installer,
 * which strips markup out of a module's translation strings before merging
 * them into the message catalogue. Both are correct as written - `[^>]`
 * cannot cross a `>`, so the first `<` always starts the span that gets
 * removed, and no `<` can survive to the left of one. A second pass finds
 * nothing. The code scanner flags the shape anyway, and it is right to: that
 * argument is four sentences long and lives nowhere near either call site.
 *
 * So the property is stated instead of reasoned about. Repeating until the
 * string stops changing makes idempotence unconditional rather than a
 * consequence of the exact character class, and the loop costs one extra
 * pass over a string that is already short. It terminates because every pass
 * that changes anything removes at least one character.
 *
 * This is a preview and merge helper, not a sanitiser. Nothing here makes
 * untrusted HTML safe to render; both callers hand the result to React,
 * which escapes it.
 */
export function stripHtmlTags(html: string): string {
    let out = html;
    let previous: string;
    do {
        previous = out;
        out = out.replace(/<[^>]*>/g, "");
    } while (out !== previous);
    return out;
}

/**
 * The BCP 47 tag to hand `Intl` for a given app locale.
 *
 * Twenty-two screens called `toLocaleString("tr-TR")` outright, so an English
 * admin read Turkish-formatted dates on every one of them, and thirty-one
 * more hand-rolled `locale === "tr" ? "tr-TR" : locale` to avoid exactly
 * that. Both are the same decision made in fifty-three places. It lives here
 * now, so adding a locale is one edit rather than a search.
 *
 * An unmapped locale is returned unchanged: `Intl` accepts a bare language
 * subtag, and guessing a region for it would be worse than not guessing.
 */
const DATE_LOCALE_TAGS: Record<string, string> = {
    en: "en-US",
    tr: "tr-TR",
    // The two whose route segment names a language with more than one
    // written standard: the catalogues are Brazilian and Simplified.
    pt: "pt-BR",
    zh: "zh-CN",
};

export function dateLocaleTag(locale: string): string {
    return DATE_LOCALE_TAGS[locale] ?? locale;
}

/**
 * Format date. Accepts an optional locale for proper localization;
 * defaults to "en-US" so existing callers keep working.
 */
export function formatDate(
    date: Date | string,
    options?: Intl.DateTimeFormatOptions,
    locale: string = "en-US",
): string {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
        ...options,
    });
}

/**
 * Format relative time (e.g., "2 hours ago"). Locale-aware via
 * Intl.RelativeTimeFormat. Pass the active locale from `useLocale()`
 * (client) or `await getLocale()` (server) - defaults to "en" so
 * callers that don't have it handy still work.
 */
export function formatRelativeTime(date: Date | string, locale: string = "en"): string {
    const d = typeof date === "string" ? new Date(date) : date;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days >= 7) return formatDate(d, undefined, locale);

    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (seconds < 60) return rtf.format(-seconds, "second");
    if (minutes < 60) return rtf.format(-minutes, "minute");
    if (hours < 24) return rtf.format(-hours, "hour");
    return rtf.format(-days, "day");
}

/**
 * Generate a slug from string
 */
// Diacritic transliteration map. Turkish + common European diacritics go first
// since they don't all decompose with NFD (ı, ğ, ş don't).
const DIACRITIC_MAP: Record<string, string> = {
    "ı": "i", "İ": "i", "ğ": "g", "Ğ": "g", "ş": "s", "Ş": "s",
    "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c",
    "ß": "ss", "æ": "ae", "Æ": "ae", "œ": "oe", "Œ": "oe",
    "ñ": "n", "Ñ": "n", "ł": "l", "Ł": "l",
};

export function slugify(text: string): string {
    return text
        .toString()
        // Transliterate explicit map first (handles Turkish ı/ğ/ş/etc.)
        .replace(/[ıİğĞşŞüÜöÖçÇßæÆœŒñÑłŁ]/g, (c) => DIACRITIC_MAP[c] || c)
        // Strip remaining diacritics via NFD decomposition (é → e, ñ → n, etc.)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^\w\-]+/g, "")
        .replace(/\-\-+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "");
}

// Alias for slugify
export const generateSlug = slugify;

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, length: number): string {
    if (text.length <= length) return text;
    return text.slice(0, length) + "...";
}

/**
 * Delay/sleep function
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
    try {
        return JSON.parse(json) as T;
    } catch {
        return fallback;
    }
}

/**
 * Generate order number
 */
export function generateOrderNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `ORD-${timestamp}-${random}`;
}
