// @vitest-environment node
/**
 * The support assistant's settings, read from what an operator saved.
 *
 * Nothing answers until the operator says so: a department with no mode is
 * off, and a value out of bounds is brought back inside them rather than
 * trusted. The hours an assistant may answer on its own are read on the
 * site's clock, and a window may run past midnight.
 */
import { describe, it, expect } from "vitest";
import { SETTING_KEYS, configFrom, modeFor } from "@/modules/ai-support/lib/config";
import { inWindow } from "@/modules/ai-support/lib/schedule";
import { termsOf } from "@/modules/ai-support/lib/terms";

describe("what an operator saved", () => {
    it("answers nowhere until a department is given a mode", () => {
        const config = configFrom({});
        expect(modeFor(config, "d1")).toBe("off");
        expect(config.classifyDepartment).toBe("off");
        expect(config.classifyPriority).toBe("off");
        expect(config.replyLanguage).toBe("member");
    });

    it("reads each department's mode, and ignores a mode that is not one", () => {
        const config = configFrom({ [SETTING_KEYS.modes]: JSON.stringify({ d1: "auto", d2: "drafts", d3: "shout" }) });
        expect(modeFor(config, "d1")).toBe("auto");
        expect(modeFor(config, "d2")).toBe("drafts");
        expect(modeFor(config, "d3")).toBe("off");
    });

    it("keeps numbers inside their bounds", () => {
        const config = configFrom({
            [SETTING_KEYS.threshold]: 140,
            [SETTING_KEYS.waitMinutes]: -5,
            [SETTING_KEYS.maxLength]: "lots",
        });
        expect(config.threshold).toBe(100);
        expect(config.waitMinutes).toBe(0);
        expect(config.maxLength).toBe(1500);
    });

    it("draws on every source until the operator chooses, and on none when they choose none", () => {
        expect(configFrom({}).sources).toBeNull();
        expect(configFrom({ [SETTING_KEYS.sources]: "[]" }).sources).toEqual([]);
        expect(configFrom({ [SETTING_KEYS.sources]: ["help-center.articles"] }).sources).toEqual(["help-center.articles"]);
    });

    it("keeps a clock time only when it is one", () => {
        const config = configFrom({ [SETTING_KEYS.from]: "09:30", [SETTING_KEYS.to]: "25:00" });
        expect(config.from).toBe("09:30");
        expect(config.to).toBe("00:00");
    });
});

describe("the hours it may answer on its own", () => {
    const weekdays = [1, 2, 3, 4, 5];
    // 2026-11-16 is a Monday.
    const at = (iso: string) => new Date(iso);

    it("are every hour when the window starts and ends at the same time", () => {
        expect(inWindow(at("2026-11-15T03:00:00Z"), "UTC", [0, 1, 2, 3, 4, 5, 6], "00:00", "00:00")).toBe(true);
    });

    it("are the hours between, on the days chosen", () => {
        expect(inWindow(at("2026-11-16T10:00:00Z"), "UTC", weekdays, "09:00", "17:00")).toBe(true);
        expect(inWindow(at("2026-11-16T17:00:00Z"), "UTC", weekdays, "09:00", "17:00")).toBe(false);
        expect(inWindow(at("2026-11-15T10:00:00Z"), "UTC", weekdays, "09:00", "17:00")).toBe(false);
    });

    it("are read on the site's clock", () => {
        // 07:00 UTC on Monday is 10:00 in Istanbul.
        expect(inWindow(at("2026-11-16T07:00:00Z"), "Europe/Istanbul", weekdays, "09:00", "17:00")).toBe(true);
        expect(inWindow(at("2026-11-16T07:00:00Z"), "UTC", weekdays, "09:00", "17:00")).toBe(false);
    });

    it("may run past midnight, counted on the day the night began", () => {
        expect(inWindow(at("2026-11-16T23:30:00Z"), "UTC", weekdays, "22:00", "06:00")).toBe(true);
        // Tuesday early morning is Monday night.
        expect(inWindow(at("2026-11-17T05:00:00Z"), "UTC", weekdays, "22:00", "06:00")).toBe(true);
        // Monday early morning is Sunday night, which was not chosen.
        expect(inWindow(at("2026-11-16T05:00:00Z"), "UTC", weekdays, "22:00", "06:00")).toBe(false);
        expect(inWindow(at("2026-11-16T12:00:00Z"), "UTC", weekdays, "22:00", "06:00")).toBe(false);
    });

    it("are none when no day is chosen", () => {
        expect(inWindow(at("2026-11-16T10:00:00Z"), "UTC", [], "00:00", "00:00")).toBe(false);
    });
});

describe("the words a ticket is looked up by", () => {
    it("are its longer words, once each, without punctuation", () => {
        expect(termsOf("Refund for my VIP rank?", "The rank never arrived, refund please!")).toEqual(
            expect.arrayContaining(["refund", "rank", "never", "arrived", "please"]),
        );
        expect(termsOf("a an of to").length).toBe(0);
        expect(new Set(termsOf("rank rank RANK")).size).toBe(1);
    });

    it("keep letters of every language", () => {
        expect(termsOf("Ödeme yapıldı ama ürün gelmedi")).toEqual(expect.arrayContaining(["ödeme", "yapıldı", "ürün", "gelmedi"]));
    });

    it("are at most ten", () => {
        expect(termsOf("alpha bravo charlie delta echoes foxtrot golfer hotel india julietta kilos limas mikes")).toHaveLength(10);
    });
});
