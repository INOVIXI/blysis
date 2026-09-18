"use client";

import { useLocale, useTimeZone } from "next-intl";
import { dateLocaleTag } from "@/core/lib/utils";
import { formatDateTimeInZone, formatInZone } from "@/core/lib/format-date";

/**
 * A date formatter bound to the reader's language and the site's zone.
 *
 * The language half replaced inline `toLocaleDateString()` calls that answered
 * in en-US whatever the visitor had chosen. The zone half is the same bug one
 * level down and it was still here: with no zone, the server formats in the
 * host's and the browser in the visitor's, so a timestamp near midnight is a
 * different day on each side, React finds the text it drew does not match, and
 * throws the subtree away to draw it again.
 *
 * The zone comes from next-intl, which carries what the request config
 * declared, so it is known on the first render rather than fetched after one.
 *
 * Example:
 *   const fmt = useLocalDate();
 *   <span>{fmt(item.createdAt)}</span>
 */
export function useLocalDate(options?: Intl.DateTimeFormatOptions) {
    const locale = useLocale();
    const timeZone = useTimeZone();
    const tag = dateLocaleTag(locale);
    return (date: Date | string | number) => formatInZone(date, tag, timeZone ?? "UTC", options);
}

/**
 * The same, for a screen that shows the clock as well as the day.
 *
 * Its own hook rather than an option, because the two produce visibly
 * different strings and a caller that meant one and got the other is a
 * regression nothing would catch.
 */
export function useLocalDateTime(options?: Intl.DateTimeFormatOptions) {
    const locale = useLocale();
    const timeZone = useTimeZone();
    const tag = dateLocaleTag(locale);
    return (date: Date | string | number) => formatDateTimeInZone(date, tag, timeZone ?? "UTC", options);
}
