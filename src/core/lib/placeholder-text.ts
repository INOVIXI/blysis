/**
 * Site placeholders in text somebody wrote: `Şu an {servers.online} kişi`.
 *
 * A site placeholder always has a dot, `{namespace.name}`: the namespace is a
 * module's id or `site`, and the name is the module's own. That is what keeps
 * these apart from an event's blanks (`{player}` in a delivery command or a
 * Discord message), which belong to the event and are filled by the module
 * sending it, each escaped for where it goes. A token may carry the words to
 * show when there is no value: `{servers.online|birkaç}`.
 *
 * Filled in one pass and as text. What a value says is never read again, so a
 * server's message of the day that reads `{site.name}` stays those words.
 * Isomorphic: the page fills on the client, a module on the server.
 */

/** A value a placeholder answers with; null when it has none right now. */
export type PlaceholderValue = string | number | null;

/** What a token without a value shows: a visitor never reads the braces. */
export const PLACEHOLDER_FALLBACK = "–";

/** `{servers.online}` or `{servers.online|fallback}`, nothing looser. */
const TOKEN = /\{([a-z][a-z0-9-]*\.[a-z][a-zA-Z0-9]*)(?:\|([^{}|]{0,60}))?\}/g;

export interface PlaceholderToken {
    name: string;
    /** The words the token asks for when there is no value, if it names any. */
    fallback: string | null;
}

/** Every site placeholder a text holds, in order. */
export function placeholderTokens(text: string): PlaceholderToken[] {
    return [...text.matchAll(TOKEN)].map((match) => ({ name: match[1], fallback: match[2] ?? null }));
}

/**
 * The text with each site placeholder replaced by its value, numbers through
 * `formatNumber` so they read the way the page's language writes them. A
 * token with no value, or one nothing on this site answers, shows its
 * fallback. Anything that is not a token is left as it was written.
 */
export function fillPlaceholderText(
    text: string,
    values: Record<string, PlaceholderValue | undefined>,
    formatNumber: (value: number) => string,
): string {
    return text.replace(TOKEN, (_whole, name: string, fallback: string | undefined) => {
        const value = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
        if (typeof value === "number") return formatNumber(value);
        if (typeof value === "string") return value;
        return fallback ?? PLACEHOLDER_FALLBACK;
    });
}
