/**
 * A day-only date formatter takes no clock options.
 *
 * The account's Sessions tab asked `useLocalDate` for
 * `{ dateStyle: "medium", timeStyle: "short" }`. That hook formats with
 * `toLocaleDateString`, which throws `TypeError: Invalid option : timeStyle`
 * for any time option, so the tab never rendered: every member opening their
 * sessions read "this part of the page could not be loaded".
 *
 * A screen that wants the clock uses `useLocalDateTime`. The day-only path now
 * refuses time options in its type, so the next caller who reaches for one is
 * stopped by the type check instead of by a member.
 */
import { describe, it, expect } from "vitest";
import { formatDateTimeInZone, formatInZone } from "@/core/lib/format-date";

const MOMENT = new Date("2026-11-11T09:34:38Z");

describe("dates with and without the clock", () => {
    it("formats the day and the time together through the date-time formatter", () => {
        const text = formatDateTimeInZone(MOMENT, "en-GB", "UTC", { dateStyle: "medium", timeStyle: "short" });
        expect(text).toContain("2026");
        expect(text).toContain("09:34");
    });

    it("formats a day on its own through the day formatter", () => {
        expect(formatInZone(MOMENT, "en-GB", "UTC", { dateStyle: "medium" })).toBe("11 Nov 2026");
    });

    it("is why the day formatter takes no clock: the runtime refuses it there", () => {
        // The exact failure the Sessions tab hit. Kept as a test so a change to
        // the day formatter that starts accepting the option is noticed.
        expect(() => MOMENT.toLocaleDateString("en-GB", { timeStyle: "short" })).toThrow(TypeError);
    });
});
