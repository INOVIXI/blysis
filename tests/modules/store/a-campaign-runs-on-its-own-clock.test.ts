/**
 * A campaign: one price change, ten products, opening and closing by itself.
 *
 * Every rule a campaign needs already exists per product - a weekly window, a
 * sale price, an allowance that refills - and setting them ten times by hand
 * is how a shop ends up with nine products on offer and one that was missed.
 * The campaign is the missing noun: name it once, list what is in it, and it
 * turns itself on and off.
 *
 * Two decisions are pinned here because both are silent when wrong.
 *
 * The window wraps past midnight, exactly as a product's own hours do - a
 * Friday event running 22:00 to 02:00 is open at half past midnight on
 * Saturday, and a check that reads Saturday against a Friday list shuts the
 * shop in the middle of its own event.
 *
 * And where a product is already discounted, the buyer pays the lower of the
 * two. A campaign is meant to be an offer; charging somebody more than the
 * standing sale price because an event started is the opposite of one.
 */
import { describe, it, expect } from "vitest";
import { campaignIsRunning, campaignPriceFor } from "@/modules/store/lib/campaign";

const friday = new Date("2026-09-11T20:00:00Z");
const saturdayEarly = new Date("2026-09-12T00:30:00Z");
const saturdayLate = new Date("2026-09-12T20:00:00Z");

/** Fridays, 18:00 to 23:00. */
const fridayEvening = { isActive: true, days: [5], fromMinute: 18 * 60, untilMinute: 23 * 60 };
/** Fridays, 22:00 to 02:00 - wraps past midnight. */
const lateNight = { isActive: true, days: [5], fromMinute: 22 * 60, untilMinute: 2 * 60 };

describe("whether a campaign is running", () => {
    it("runs inside its own evening", () => {
        expect(campaignIsRunning(fridayEvening, friday, "UTC")).toBe(true);
    });

    it("does not run on another day", () => {
        expect(campaignIsRunning(fridayEvening, saturdayLate, "UTC")).toBe(false);
    });

    it("keeps running past midnight when its hours wrap", () => {
        expect(campaignIsRunning(lateNight, saturdayEarly, "UTC")).toBe(true);
    });

    it("never runs while it is switched off", () => {
        expect(campaignIsRunning({ ...fridayEvening, isActive: false }, friday, "UTC")).toBe(false);
    });

    it("runs every day when it names none", () => {
        const everyEvening = { ...fridayEvening, days: [] };
        expect(campaignIsRunning(everyEvening, saturdayLate, "UTC")).toBe(true);
    });
});

describe("what a product costs while a campaign runs", () => {
    it("is the campaign price when the product is in it", () => {
        expect(campaignPriceFor("vip", 20, [{ productId: "vip", price: 12 }])).toBe(12);
    });

    it("is the ordinary price for a product the campaign does not list", () => {
        expect(campaignPriceFor("key", 20, [{ productId: "vip", price: 12 }])).toBe(20);
    });

    it("leaves a better standing price alone", () => {
        // The product is already down to 10; an event at 12 must not put it up.
        expect(campaignPriceFor("vip", 10, [{ productId: "vip", price: 12 }])).toBe(10);
    });

    it("ignores a campaign price that is not a sensible one", () => {
        expect(campaignPriceFor("vip", 20, [{ productId: "vip", price: -5 }])).toBe(20);
        expect(campaignPriceFor("vip", 20, [{ productId: "vip", price: Number.NaN }])).toBe(20);
    });

    it("is the better of two campaigns that both list the product, in either order", () => {
        // Two campaigns open at once over one product are two offers, and the
        // buyer gets the lower. The first row found used to win, so the order
        // the database returned them in set the price.
        expect(campaignPriceFor("vip", 20, [{ productId: "vip", price: 15 }, { productId: "vip", price: 12 }])).toBe(12);
        expect(campaignPriceFor("vip", 20, [{ productId: "vip", price: 12 }, { productId: "vip", price: 15 }])).toBe(12);
    });

    it("allows a campaign to make something free", () => {
        // Zero is a price an operator can mean, unlike a negative one.
        expect(campaignPriceFor("vip", 20, [{ productId: "vip", price: 0 }])).toBe(0);
    });
});
