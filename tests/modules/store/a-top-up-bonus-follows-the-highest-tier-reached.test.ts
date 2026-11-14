/**
 * A credit bonus campaign gives the highest tier a payment reaches, only while
 * it runs, and the larger of two campaigns that run at once.
 *
 * The rules are small and every one of them is a way to pay the wrong number:
 * a tier missed by a cent, a campaign that keeps paying after its end, a
 * buyer given the smaller of two offers on the page, a ladder where paying
 * more gets less. They are tested here without a database; settling and
 * refunding are in `a-top-up-bonus-is-fixed-when-the-payment-starts.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
    bestBonus,
    bonusCreditsOf,
    campaignInstant,
    campaignProblem,
    campaignRunning,
    overlapping,
    readTiers,
    tierFor,
    type BonusCampaign,
} from "@/modules/store/lib/credit-bonus";

const TIERS = [
    { minAmount: 100, percent: 5 },
    { minAmount: 250, percent: 10 },
    { minAmount: 500, percent: 20 },
];

const NOW = new Date("2026-11-20T12:00:00Z");

function campaign(overrides: Partial<BonusCampaign> = {}): BonusCampaign {
    return {
        id: "weekend",
        name: "Weekend",
        startsAt: new Date("2026-11-20T00:00:00Z"),
        endsAt: new Date("2026-11-23T00:00:00Z"),
        isActive: true,
        tiers: TIERS,
        ...overrides,
    };
}

describe("the tier a payment reaches", () => {
    it("is none below the first tier", () => {
        expect(tierFor(TIERS, 99.99)).toBeNull();
    });

    it("starts exactly at a tier's amount", () => {
        expect(tierFor(TIERS, 100)?.percent).toBe(5);
        expect(tierFor(TIERS, 249.99)?.percent).toBe(5);
        expect(tierFor(TIERS, 250)?.percent).toBe(10);
        expect(tierFor(TIERS, 500)?.percent).toBe(20);
    });

    it("is the highest one reached, however far past it", () => {
        expect(tierFor(TIERS, 10_000)?.percent).toBe(20);
    });

    it("does not miss a tier for a float that is a hair under it", () => {
        expect(tierFor(TIERS, 0.1 + 0.2 + 249.7)?.percent).toBe(10);
    });

    it("does not care in which order the tiers were stored", () => {
        expect(tierFor([...TIERS].reverse(), 300)?.percent).toBe(10);
    });
});

describe("the bonus credits", () => {
    it("are rounded down", () => {
        expect(bonusCreditsOf(999, 5)).toBe(49);
    });

    it("are taken of the credits bought only, never of a package's own bonus", () => {
        // A package of 1000 credits with 200 on top, sold for 250, in a 10%
        // campaign: 100 more, not 120.
        const bonus = bestBonus([campaign()], { paid: 250, baseCredits: 1000 }, NOW);
        expect(bonus).toEqual({ campaignId: "weekend", name: "Weekend", percent: 10, credits: 100 });
    });
});

describe("a campaign's dates", () => {
    it("pays nothing before it starts", () => {
        expect(bestBonus([campaign()], { paid: 500, baseCredits: 1000 }, new Date("2026-11-19T23:59:59Z"))).toBeNull();
    });

    it("pays from the instant it starts", () => {
        expect(campaignRunning(campaign(), new Date("2026-11-20T00:00:00Z"))).toBe(true);
    });

    it("pays nothing from the instant it ends", () => {
        expect(campaignRunning(campaign(), new Date("2026-11-23T00:00:00Z"))).toBe(false);
        expect(bestBonus([campaign()], { paid: 500, baseCredits: 1000 }, new Date("2026-11-23T00:00:00Z"))).toBeNull();
    });

    it("pays nothing while it is switched off", () => {
        expect(bestBonus([campaign({ isActive: false })], { paid: 500, baseCredits: 1000 }, NOW)).toBeNull();
    });
});

describe("two campaigns at once", () => {
    const small = campaign({ id: "small", name: "Small", tiers: [{ minAmount: 100, percent: 5 }] });
    const big = campaign({ id: "big", name: "Big", tiers: [{ minAmount: 200, percent: 15 }] });

    it("give the buyer the larger bonus for that payment", () => {
        expect(bestBonus([small, big], { paid: 300, baseCredits: 1000 }, NOW)?.campaignId).toBe("big");
        expect(bestBonus([big, small], { paid: 300, baseCredits: 1000 }, NOW)?.campaignId).toBe("big");
    });

    it("give the one whose tier the payment reaches when the other's it does not", () => {
        expect(bestBonus([small, big], { paid: 150, baseCredits: 1000 }, NOW)?.campaignId).toBe("small");
    });

    it("are marked as overlapping, and only while both are on", () => {
        const later = campaign({ id: "later", startsAt: new Date("2026-11-23T00:00:00Z"), endsAt: new Date("2026-11-25T00:00:00Z") });
        expect(overlapping([small, big, later]).sort()).toEqual(["big", "small"]);
        expect(overlapping([small, campaign({ id: "big", isActive: false })])).toEqual([]);
    });
});

describe("what an operator can save", () => {
    const starts = new Date("2026-11-20T00:00:00Z");
    const ends = new Date("2026-11-23T00:00:00Z");

    it("accepts a ladder that goes up", () => {
        expect(campaignProblem({ startsAt: starts, endsAt: ends, tiers: TIERS })).toBeNull();
    });

    it("refuses an end that is not after the start", () => {
        expect(campaignProblem({ startsAt: ends, endsAt: starts, tiers: TIERS })).toBe("credit_bonus_dates");
        expect(campaignProblem({ startsAt: starts, endsAt: starts, tiers: TIERS })).toBe("credit_bonus_dates");
        expect(campaignProblem({ startsAt: null, endsAt: ends, tiers: TIERS })).toBe("credit_bonus_dates");
    });

    it("refuses tiers that do not go up in both amount and percent", () => {
        const sameAmount = [{ minAmount: 100, percent: 5 }, { minAmount: 100, percent: 10 }];
        const lessForMore = [{ minAmount: 100, percent: 10 }, { minAmount: 250, percent: 5 }];
        expect(campaignProblem({ startsAt: starts, endsAt: ends, tiers: sameAmount })).toBe("credit_bonus_tiers");
        expect(campaignProblem({ startsAt: starts, endsAt: ends, tiers: lessForMore })).toBe("credit_bonus_tiers");
    });

    it("refuses a percent outside 1 to 500, an amount of nothing, no tiers and too many", () => {
        for (const tiers of [
            [{ minAmount: 100, percent: 0 }],
            [{ minAmount: 100, percent: 501 }],
            [{ minAmount: 100, percent: 2.5 }],
            [{ minAmount: 0, percent: 5 }],
            [],
            Array.from({ length: 11 }, (_, i) => ({ minAmount: (i + 1) * 10, percent: i + 1 })),
        ]) {
            expect(campaignProblem({ startsAt: starts, endsAt: ends, tiers })).toBe("credit_bonus_tiers");
        }
    });

    it("reads stored tiers that are not tiers as nothing to pay", () => {
        expect(readTiers([{ minAmount: "x", percent: 5 }, null, { minAmount: 10, percent: 9999 }, { minAmount: 10, percent: 5 }])).toEqual([
            { minAmount: 10, percent: 5 },
        ]);
        expect(readTiers("not a list")).toEqual([]);
    });
});

describe("the dates a form sends", () => {
    it("read a wall clock on the site's zone", () => {
        expect(campaignInstant("2026-11-20T18:00", "Europe/Istanbul")?.toISOString()).toBe("2026-11-20T15:00:00.000Z");
    });

    it("read an instant with its own offset as that instant", () => {
        expect(campaignInstant("2026-11-20T18:00:00+03:00", "UTC")?.toISOString()).toBe("2026-11-20T15:00:00.000Z");
        expect(campaignInstant("2026-11-20T15:00:00Z", "Europe/Istanbul")?.toISOString()).toBe("2026-11-20T15:00:00.000Z");
    });

    it("read nonsense as nothing", () => {
        expect(campaignInstant("not a date at all", "UTC")).toBeNull();
    });
});
