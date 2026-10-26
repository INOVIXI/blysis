import { placeholderTokens, fillPlaceholderText, type PlaceholderValue } from "@/core/lib/placeholder-text";

/**
 * Site placeholders in the site's own words: "{servers.online} players on
 * {site.name}" in the translation editor reads the live values on the page.
 *
 * The catalogue is a set of ICU messages, so a value cannot be dropped in as
 * it comes: `{site.name}` is a blank the calling code never fills and would
 * fail the string, and a value holding a brace, an apostrophe or a tag would
 * be read as syntax. Each token is replaced before the formatter sees the
 * message, by the value quoted so the formatter prints it as written. A `#`
 * is left bare, since quoting it outside a plural prints the quotes: a value
 * with one inside a plural option reads the count there.
 *
 * Filled after the cached catalogue is read, never into the cache, so a
 * value is as fresh as the placeholder's own cache and the catalogue's two
 * minutes do not stack on top of it. `a-string-can-say-a-live-value` holds it.
 */

/** How long a page waits for the values before it shows their fallbacks. */
const BUDGET_MS = 200;

/** Quoted so ICU reads it as text: `''` is an apostrophe, `'{'` a brace. */
function quoteForMessage(text: string): string {
    return text.replace(/'/g, "''").replace(/[{}<>]/g, (char) => `'${char}'`);
}

function eachString(tree: unknown, visit: (text: string) => void): void {
    if (typeof tree === "string") visit(tree);
    else if (tree && typeof tree === "object") for (const value of Object.values(tree)) eachString(value, visit);
}

function mapStrings(tree: unknown, map: (text: string) => string): unknown {
    if (typeof tree === "string") return map(tree);
    if (!tree || typeof tree !== "object") return tree;
    return Object.fromEntries(Object.entries(tree).map(([key, value]) => [key, mapStrings(value, map)]));
}

/** Every site placeholder named anywhere in the catalogue. */
export function catalogueTokens(messages: Record<string, unknown>): Set<string> {
    const names = new Set<string>();
    eachString(messages, (text) => {
        if (!text.includes(".")) return;
        for (const token of placeholderTokens(text)) names.add(token.name);
    });
    return names;
}

/** The catalogue with every site placeholder replaced by its quoted value. */
export function fillCatalogue(
    messages: Record<string, unknown>,
    values: Record<string, PlaceholderValue | undefined>,
    locale: string,
): Record<string, unknown> {
    const numbers = new Intl.NumberFormat(locale);
    return mapStrings(messages, (text) => {
        if (!text.includes(".")) return text;
        return fillPlaceholderText(text, values, (value) => numbers.format(value), quoteForMessage);
    }) as Record<string, unknown>;
}

/**
 * The catalogue as a page should read it. Asks for the values only when a
 * string names one, which on most sites none does.
 */
export async function withLiveValues(messages: Record<string, unknown>, locale: string): Promise<Record<string, unknown>> {
    if (catalogueTokens(messages).size === 0) return messages;
    // Loaded here rather than at the top: the resolver brings the module
    // registry and the cache with it, and the catalogue is read everywhere,
    // from places that need neither when no string names a value.
    const { resolvePlaceholders } = await import("@/core/lib/placeholders");
    const { values } = await resolvePlaceholders({ budgetMs: BUDGET_MS });
    return fillCatalogue(messages, values, locale);
}
