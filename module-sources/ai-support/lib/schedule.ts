import { zonedNow } from "@/core/sdk";

/**
 * Whether a moment falls inside the hours the assistant may answer on its
 * own, read on the site's clock rather than the server's.
 *
 * `from` and `to` are HH:MM. A window whose end is before its start runs
 * past midnight, and the day that counts is the one it started on, so a
 * Friday night window still covers early Saturday. The same time at both
 * ends is the whole day.
 */

function minutes(hhmm: string): number {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
}

export function inWindow(at: Date, timeZone: string, days: readonly number[], from: string, to: string): boolean {
    const { weekday: day, minutes: minute } = zonedNow(at, timeZone);
    const start = minutes(from);
    const end = minutes(to);
    if (start === end) return days.includes(day);
    if (start < end) return days.includes(day) && minute >= start && minute < end;
    // Past midnight: before the end belongs to the day before.
    if (minute >= start) return days.includes(day);
    if (minute < end) return days.includes((day + 6) % 7);
    return false;
}
