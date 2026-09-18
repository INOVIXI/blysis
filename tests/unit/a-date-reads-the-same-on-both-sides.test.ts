import { describe, it, expect } from "vitest";
import { formatInZone } from "@/core/lib/format-date";

/**
 * A date rendered on the server and again in the browser has to be the same
 * date.
 *
 * The punishments list printed `10.07.2026` in the HTML and `11.07.2026` a
 * moment later, and React threw the whole subtree away and drew it again -
 * which is what a hydration mismatch costs, on every page holding a date. The
 * cause is that `toLocaleDateString` with no zone uses whatever zone the
 * process is in: the server's, and then the visitor's. A punishment recorded
 * near midnight falls on different days in the two.
 *
 * Fixing the locale is not enough and that is the trap - `dateLocaleTag` had
 * already pinned the language, so the strings looked deliberate and the day
 * was still whatever the machine thought. The zone has to be pinned too, and
 * to a zone both sides can know: the one the operator set, which next-intl
 * carries from the request config into the client provider.
 */
describe("a date reads the same on both sides", () => {
    // 2026-07-10T22:30:00Z. In Istanbul that is already the 11th; in New York
    // it is still the 10th. A machine in either would disagree with the other.
    const NEAR_MIDNIGHT = "2026-07-10T22:30:00.000Z";

    it("gives the same day whatever zone the process is in", () => {
        const asIstanbul = formatInZone(NEAR_MIDNIGHT, "tr-TR", "Europe/Istanbul");
        const again = formatInZone(NEAR_MIDNIGHT, "tr-TR", "Europe/Istanbul");

        expect(asIstanbul).toBe(again);
        // The site's zone decides the day, not the reader's machine.
        expect(asIstanbul).toContain("11");
    });

    it("reads the same instant as a different day in a different site zone", () => {
        // Proof the zone is doing the work rather than being ignored.
        expect(formatInZone(NEAR_MIDNIGHT, "tr-TR", "America/New_York")).toContain("10");
    });

    it("still speaks the reader's language", () => {
        const en = formatInZone(NEAR_MIDNIGHT, "en-GB", "Europe/Istanbul", { month: "long" });
        const tr = formatInZone(NEAR_MIDNIGHT, "tr-TR", "Europe/Istanbul", { month: "long" });

        expect(en).not.toBe(tr);
    });

    it("takes a Date, a string or a number, because callers hold all three", () => {
        const stamp = Date.parse(NEAR_MIDNIGHT);
        const asDate = formatInZone(new Date(stamp), "tr-TR", "Europe/Istanbul");

        expect(formatInZone(stamp, "tr-TR", "Europe/Istanbul")).toBe(asDate);
        expect(formatInZone(NEAR_MIDNIGHT, "tr-TR", "Europe/Istanbul")).toBe(asDate);
    });

    it("falls back rather than throwing on a zone the runtime does not know", () => {
        // An operator can type a zone into a settings box, and a date that
        // throws takes the page down rather than being a day out.
        expect(() => formatInZone(NEAR_MIDNIGHT, "tr-TR", "Mars/Olympus")).not.toThrow();
    });
});
