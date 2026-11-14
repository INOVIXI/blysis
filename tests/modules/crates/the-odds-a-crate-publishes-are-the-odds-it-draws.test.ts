// @vitest-environment node
/**
 * The odds a crate publishes are the odds it draws.
 *
 * A crate somebody pays for has to say what is in it and how likely each
 * thing is, and the figure has to be true. The page prints `rewardChance`,
 * the opening calls `drawReward`, and these tests hold the two together: the
 * published chances add up to the whole crate, a reward switched off by a
 * weight of zero never comes out, and over many draws with the same random
 * source the route uses each reward comes out about as often as its weight
 * says.
 */
import { describe, it, expect } from "vitest";
import { randomInt } from "crypto";
import {
    drawReward,
    limitWindowStart,
    paymentFor,
    refusalFor,
    rewardChance,
    rewardHandsSomethingOver,
} from "@/modules/crates/lib/crates";

const CRATE = [
    { id: "common", weight: 60 },
    { id: "rare", weight: 30 },
    { id: "legendary", weight: 9 },
    { id: "jackpot", weight: 1 },
];

describe("the published chances", () => {
    it("add up to the whole crate", () => {
        const sum = CRATE.reduce((total, reward) => total + rewardChance(CRATE, reward), 0);
        expect(sum).toBeCloseTo(100, 10);
    });

    it("still add up to the whole crate after rounding to what the page prints", () => {
        const odd = [{ weight: 1 }, { weight: 1 }, { weight: 1 }];
        const printed = odd.map((reward) => Math.round(rewardChance(odd, reward) * 100) / 100);
        expect(Math.abs(printed.reduce((a, b) => a + b, 0) - 100)).toBeLessThanOrEqual(0.01 * odd.length);
    });

    it("give a reward switched off no chance, and leave it out of the others' share", () => {
        const rewards = [{ weight: 50 }, { weight: 50, isActive: false }, { weight: 0 }];
        expect(rewardChance(rewards, rewards[0])).toBe(100);
        expect(rewardChance(rewards, rewards[1])).toBe(0);
        expect(rewardChance(rewards, rewards[2])).toBe(0);
    });

    it("are zero across the board for a crate with nothing weighted, not a division by zero", () => {
        const rewards = [{ weight: 0 }, { weight: 0 }];
        expect(rewardChance(rewards, rewards[0])).toBe(0);
        expect(drawReward(rewards, () => 0)).toBeNull();
    });
});

describe("the draw", () => {
    it("lands on each reward for exactly its share of the rolls", () => {
        // Every roll the source can return, once: the draw is a pure function
        // of the roll, so this is the distribution with no noise at all.
        const total = CRATE.reduce((sum, reward) => sum + reward.weight, 0);
        const counts = new Map<string, number>();
        for (let roll = 0; roll < total; roll++) {
            const reward = drawReward(CRATE, () => roll)!;
            counts.set(reward.id, (counts.get(reward.id) ?? 0) + 1);
        }
        for (const reward of CRATE) expect(counts.get(reward.id)).toBe(reward.weight);
    });

    it("never lands on a weight of zero, on any roll, wherever it sits in the list", () => {
        const rewards = [{ id: "off-first", weight: 0 }, { id: "a", weight: 3 }, { id: "off-middle", weight: 0 }, { id: "b", weight: 2 }, { id: "off-last", weight: 0 }];
        for (let roll = 0; roll < 5; roll++) {
            expect(drawReward(rewards, () => roll)!.id).not.toMatch(/^off/);
        }
    });

    it("asks the source for a number below the total weight, which is what randomInt(0, max) returns", () => {
        let asked = 0;
        drawReward(CRATE, (max) => { asked = max; return max - 1; });
        expect(asked).toBe(100);
        expect(drawReward(CRATE, (max) => max - 1)!.id).toBe("jackpot");
        expect(drawReward(CRATE, () => 0)!.id).toBe("common");
    });

    it("comes out close to the weights over many draws from the crypto source", () => {
        const draws = 100_000;
        const counts = new Map<string, number>();
        for (let i = 0; i < draws; i++) {
            const reward = drawReward(CRATE, (max) => randomInt(0, max))!;
            counts.set(reward.id, (counts.get(reward.id) ?? 0) + 1);
        }
        for (const reward of CRATE) {
            const p = reward.weight / 100;
            const expected = draws * p;
            // Six standard deviations: a correct draw fails this about once in
            // five hundred million runs, and a draw off by a single point on
            // the common reward is a thousand rewards out.
            const tolerance = 6 * Math.sqrt(draws * p * (1 - p));
            expect(Math.abs((counts.get(reward.id) ?? 0) - expected)).toBeLessThan(tolerance);
        }
    });
});

describe("who may open a crate, and how", () => {
    const rules = { isActive: true, cost: 100, sellsKeys: true, perPersonLimit: 3, roleIds: [], hasRewards: true };
    const opener = { signedIn: true, roleId: null, credits: 500, keys: 0, openedInWindow: 0 };

    it("spends a key first when the member holds one and names no payment", () => {
        expect(paymentFor(rules, { keys: 2 }, null)).toBe("key");
        expect(paymentFor(rules, { keys: 0 }, null)).toBe("credits");
        expect(paymentFor({ cost: 0 }, { keys: 0 }, null)).toBeNull();
        expect(paymentFor({ cost: 0 }, { keys: 5 }, "credits")).toBeNull();
    });

    it("refuses at the limit before it looks at the wallet", () => {
        expect(refusalFor(rules, { ...opener, credits: 0, openedInWindow: 3 }, "credits")).toBe("limit_reached");
    });

    it("refuses each missing way of paying with its own reason", () => {
        expect(refusalFor(rules, { ...opener, credits: 10 }, "credits")).toBe("not_enough_credits");
        expect(refusalFor(rules, opener, "key")).toBe("no_key");
        expect(refusalFor({ ...rules, sellsKeys: false }, opener, null)).toBe("not_for_sale");
        expect(refusalFor(rules, opener, "credits")).toBeNull();
    });

    it("keeps a crate for a rank to that rank", () => {
        expect(refusalFor({ ...rules, roleIds: ["vip"] }, opener, "credits")).toBe("wrong_role");
        expect(refusalFor({ ...rules, roleIds: ["vip"] }, { ...opener, roleId: "vip" }, "credits")).toBeNull();
    });

    it("counts a limit back over a rolling window, and over everything for `ever`", () => {
        const now = new Date("2026-11-12T12:00:00Z");
        expect(limitWindowStart("day", now)?.toISOString()).toBe("2026-11-11T12:00:00.000Z");
        expect(limitWindowStart("week", now)?.toISOString()).toBe("2026-11-05T12:00:00.000Z");
        expect(limitWindowStart("ever", now)).toBeNull();
    });

    it("leaves out a product reward nobody pointed at a product", () => {
        expect(rewardHandsSomethingOver({ kind: "product", productId: null, value: 1 })).toBe(false);
        expect(rewardHandsSomethingOver({ kind: "product", productId: "p1", value: 1 })).toBe(true);
        expect(rewardHandsSomethingOver({ kind: "credits", value: 0 })).toBe(false);
        expect(rewardHandsSomethingOver({ kind: "nothing", value: 0 })).toBe(true);
    });
});
