/**
 * The site's own clock.
 *
 * "Opens Friday at 18:00" is not a moment until somebody says whose clock it
 * is. The server keeps UTC, the operator lives somewhere, and a visitor could
 * be anywhere - and only one of those makes a limited run start at the same
 * instant for everyone, which is the whole point of a limited run. So the
 * operator sets a zone in Settings and everything scheduled reads it here.
 *
 * Getting it wrong is silent. On a server in UTC with an operator in
 * Istanbul, a window written as 18:00 opens at 21:00 their time and nobody
 * sees an error - they see a sale that did not start.
 */

/** What the site keeps when nobody has said otherwise. */
export const DEFAULT_TIME_ZONE = "UTC";

/** The setting an operator writes in Settings > Site. */
export const TIME_ZONE_SETTING = "site_timezone";

/**
 * Whether a string names a zone this runtime knows.
 *
 * The value is typed by a person, so it may be anything at all; a bad one has
 * to mean "keep the clock we had" rather than an exception on every page that
 * shows a price.
 */
export function isValidTimeZone(zone: string): boolean {
    if (!zone) return false;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
        return true;
    } catch {
        return false;
    }
}

function safeZone(zone: string | null | undefined): string {
    return zone && isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
}

/**
 * The parts of the wall clock in `zone` at `at`.
 *
 * `Intl` rather than arithmetic on an offset: an offset is a number somebody
 * remembered, and half the world changes theirs twice a year.
 */
function partsIn(at: Date, zone: string): { weekday: number; hour: number; minute: number } {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: safeZone(zone),
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    });

    const parts = Object.fromEntries(
        formatter.formatToParts(at).map((part) => [part.type, part.value]),
    ) as Record<string, string>;

    const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return {
        weekday: Math.max(0, DAYS.indexOf(parts.weekday)),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
    };
}

/** Sunday is 0, the way every schedule in this codebase counts. */
export function weekdayIn(at: Date, zone: string): number {
    return partsIn(at, zone).weekday;
}

/** Minutes since midnight on that zone's clock. */
export function minutesInto(at: Date, zone: string): number {
    const { hour, minute } = partsIn(at, zone);
    return hour * 60 + minute;
}

/** Both halves at once, because every caller wants both. */
export function zonedNow(at: Date, zone: string): { weekday: number; minutes: number } {
    const { weekday, hour, minute } = partsIn(at, zone);
    return { weekday, minutes: hour * 60 + minute };
}

/**
 * A wall-clock string the operator typed, as the instant it names on the
 * site's clock.
 *
 * The admin form sends "2026-10-20T18:00" and means six in the evening where
 * the shop is. Converting that in the browser would use the browser's zone,
 * which is the one zone that has nothing to do with the shop - an operator on
 * holiday would schedule a sale three hours out. So the string travels as
 * written and this turns it into an instant, on the server, where the zone is
 * the site's own.
 *
 * The two-step is the standard trick without a date library: read the naive
 * value as UTC, ask what that instant looks like in the zone, and shift by the
 * difference. Within an hour of a daylight-saving change the answer can land
 * an hour out, which is the known cost of not carrying a full tz database.
 */
export function wallClockToInstant(wall: string, zone: string): Date | null {
    if (!wall) return null;
    const asUtc = new Date(`${wall.length === 16 ? `${wall}:00` : wall}Z`);
    if (Number.isNaN(asUtc.getTime())) return null;

    const shown = new Date(asUtc.toLocaleString("en-US", { timeZone: safeZone(zone) }));
    const naive = new Date(asUtc.toLocaleString("en-US", { timeZone: "UTC" }));
    return new Date(asUtc.getTime() + (naive.getTime() - shown.getTime()));
}

/** The instant the day containing `at` began on the site's clock. */
export function startOfDayIn(at: Date, zone: string): Date {
    const midnight = wallClockToInstant(`${instantToWallClock(at, zone).slice(0, 10)}T00:00`, zone);
    return midnight ?? at;
}

/** The other direction, for a form that has to show what was saved. */
export function instantToWallClock(at: Date, zone: string): string {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone: safeZone(zone),
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", hourCycle: "h23",
        }).formatToParts(at).map((part) => [part.type, part.value]),
    ) as Record<string, string>;
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
