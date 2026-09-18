/**
 * Formatting a date so the server and the browser agree on which day it is.
 *
 * `toLocaleDateString` with no zone uses the zone the process is in. On the
 * server that is the host's; in the browser it is the visitor's. A punishment
 * recorded near midnight then renders as the 10th in the HTML and the 11th a
 * moment later, React finds the text it drew does not match the text it was
 * given, and throws the whole subtree away to draw it again - on every page
 * holding a date.
 *
 * The locale was already pinned, which is what made this hard to see: the
 * strings looked deliberate, and only the day was wrong, and only for readers
 * in a different zone from the server, and only for timestamps near midnight.
 *
 * So the zone is pinned too, to the one the operator set. It reaches the
 * browser through next-intl - the request config declares it and the client
 * provider carries it - which is why both sides can name the same one without
 * the second one having to fetch anything before its first render.
 *
 * Isomorphic on purpose: no import here reaches the database or a Node
 * builtin, because the client hook and the server render both call it.
 */

/** What the site falls back to when a zone is missing or the runtime rejects it. */
const NEUTRAL_ZONE = "UTC";

/**
 * One date, in one language, in one zone.
 *
 * A zone the runtime does not recognise falls back rather than throwing. An
 * operator can type one into a settings box, and a date that throws takes the
 * page down instead of being a day out.
 */
export function formatInZone(
    value: Date | string | number,
    localeTag: string,
    timeZone: string,
    options: Intl.DateTimeFormatOptions = {},
): string {
    const date = value instanceof Date ? value : new Date(value);

    try {
        return date.toLocaleDateString(localeTag, { ...options, timeZone });
    } catch {
        return date.toLocaleDateString(localeTag, { ...options, timeZone: NEUTRAL_ZONE });
    }
}

/** The same, for a caller that wants the clock as well as the day. */
export function formatDateTimeInZone(
    value: Date | string | number,
    localeTag: string,
    timeZone: string,
    options: Intl.DateTimeFormatOptions = {},
): string {
    const date = value instanceof Date ? value : new Date(value);

    try {
        return date.toLocaleString(localeTag, { ...options, timeZone });
    } catch {
        return date.toLocaleString(localeTag, { ...options, timeZone: NEUTRAL_ZONE });
    }
}
