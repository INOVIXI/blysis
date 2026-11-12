import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { upgradeCredit, priceAfterCredit } from "@/modules/store/lib/upgrade-credit";
import { priceCartLines } from "@/modules/store/lib/cart-pricing";
import { computeOrderPricing } from "@/modules/store/lib/pricing";

const ownedRows = vi.fn<(args: unknown) => Promise<{ productId: string }[]>>(async () => []);
const ladderRows = vi.fn<(args: unknown) => Promise<{ id: string }[]>>(async () => []);

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        ownedProduct: { findMany: (args: unknown) => ownedRows(args) },
        product: { findMany: (args: unknown) => ladderRows(args) },
    },
    moduleSettings: async () => ({ enableUpgradeCredit: true }),
}));

const { creditingPurchases } = await import("@/modules/store/lib/upgrade-credit-server");

/**
 * Somebody standing on a rung pays the difference to the next one.
 *
 * A shop that sells VIP, VIP+ and MVP sells the same thing three times.
 * Charging the full price of the dearer one to somebody who has already bought
 * the cheaper one charges them twice for the part they share, so the credit
 * exists and always has.
 *
 * What did not exist was anybody being told. The rule lived inside
 * `computeOrderPricing`, which is reached from one place - the checkout - so a
 * buyer who owned VIP read 19.99 on the card, on the product page, in the cart
 * and in the comparison table, and was charged 10.00. The direction of the
 * surprise is not the point: a price nobody can see before they commit is not
 * an offer, and an offer nobody can discover sells nothing.
 *
 * The arithmetic is one function now and five screens ask it. These are the
 * rules that function keeps.
 */

const ROOT = process.cwd();

const VIP = { id: "vip", categoryId: "ranks", price: 9.99 };
const VIP_PLUS = { id: "vip-plus", categoryId: "ranks", price: 19.99 };
const MVP = { id: "mvp", categoryId: "ranks", price: 39.99 };
const KEY = { id: "key", categoryId: "crates", price: 4.99 };
const LADDER = [VIP, VIP_PLUS, MVP, KEY];

describe("an upgrade costs the difference", () => {
    it("takes off what the rung below cost", () => {
        expect(upgradeCredit(VIP_PLUS, LADDER, new Set(["vip"]))).toBe(9.99);
        expect(priceAfterCredit(VIP_PLUS.price, 9.99)).toBeCloseTo(10, 5);
    });

    it("credits the highest rung owned, not the sum of them", () => {
        // Somebody who climbed VIP then VIP+ has paid 9.99 and 10.00. Adding
        // both toward MVP would refund the ladder they climbed.
        expect(upgradeCredit(MVP, LADDER, new Set(["vip", "vip-plus"]))).toBe(19.99);
    });

    it("credits nothing across shelves", () => {
        // A crate key is not a lower rank. The category is the shop's own
        // grouping of "the same thing at different levels" and the only one
        // this module has.
        expect(upgradeCredit(VIP_PLUS, LADDER, new Set(["key"]))).toBe(0);
    });

    it("credits nothing for a product with no shelf", () => {
        const loose = { id: "loose", categoryId: null, price: 50 };
        expect(upgradeCredit(loose, [...LADDER, loose], new Set(["vip"]))).toBe(0);
    });

    it("never credits a dearer or equal purchase", () => {
        // Downgrading is not free. Owning MVP does not make VIP+ cost nothing.
        expect(upgradeCredit(VIP_PLUS, LADDER, new Set(["mvp"]))).toBe(0);
        expect(upgradeCredit(VIP_PLUS, LADDER, new Set(["vip-plus"]))).toBe(0);
    });

    it("never pays somebody to upgrade", () => {
        // The invariant rather than a case: whoever owns whatever, what is left
        // to pay is never negative and never more than the price. This started
        // as a contrived case meant to make a `Math.min` guard fire, and the
        // case could not be built - only a cheaper rung qualifies, so the
        // credit cannot reach the price. The guard was deleted; this is what
        // it was guarding.
        const everyone = [
            new Set<string>(),
            new Set(["vip"]),
            new Set(["vip", "vip-plus"]),
            new Set(["mvp"]),
            new Set(["key", "vip"]),
        ];
        for (const rung of LADDER) {
            for (const owns of everyone) {
                const credit = upgradeCredit(rung, LADDER, owns);
                expect(credit).toBeLessThan(rung.price + 0.001);
                expect(priceAfterCredit(rung.price, credit)).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it("credits nothing to somebody who already owns what they are buying", () => {
        // Somebody who upgraded to VIP+ owns it. Buying it again is not an
        // upgrade, so the VIP behind it is not traded in a second time.
        expect(upgradeCredit(VIP_PLUS, LADDER, new Set(["vip", "vip-plus"]))).toBe(0);
    });

    it("credits nothing to somebody already standing above it", () => {
        // Owning MVP and VIP, VIP+ is a step down, whatever lies below it.
        expect(upgradeCredit(VIP_PLUS, LADDER, new Set(["vip", "mvp"]))).toBe(0);
    });

    it("credits nothing to somebody who owns nothing", () => {
        expect(upgradeCredit(VIP_PLUS, LADDER, new Set())).toBe(0);
    });

    it("is asked by every screen that quotes a price", () => {
        // The whole defect: one caller meant one screen told the truth. Each
        // of these reads the credit, so the card, the product page, the cart,
        // the comparison column and the till quote one number.
        const asks = [
            "module-sources/store/lib/pricing.ts",
            "module-sources/store/lib/read-store.ts",
            "module-sources/store/lib/read-product.ts",
            "module-sources/store/api/cart/route.ts",
            "module-sources/store/hooks/comparison-columns.ts",
        ];
        // Either by asking directly, line by line through `lineCredit`, or
        // through `cart-pricing.ts`, which is the same question wrapped: the
        // cart screen and the coupon preview both need the basket's worth and
        // were working it out apart.
        const missing = asks.filter((file) => {
            const source = fs.readFileSync(path.join(ROOT, file), "utf8");
            return !["upgradeCredit(", "lineCredit(", "priceCartLines("].some((call) => source.includes(call));
        });
        expect(missing, missing.join("\n")).toEqual([]);
    });

    it("lets an operator turn it off, and reads the switch in one place", () => {
        // A screen that checked the setting itself would be a screen that can
        // forget to. `creditingPurchases` answers with nothing when it is off,
        // so every caller gets a zero credit without a second branch.
        const server = fs.readFileSync(
            path.join(ROOT, "module-sources/store/lib/upgrade-credit-server.ts"),
            "utf8",
        );
        expect(server).toContain("enableUpgradeCredit");
        expect(server).toContain("stillOwnedWhere");

        const manifest = JSON.parse(
            fs.readFileSync(path.join(ROOT, "module-sources/store/module.json"), "utf8"),
        ) as { settings?: { key: string; default: unknown }[] };
        const setting = manifest.settings?.find((s) => s.key === "enableUpgradeCredit");
        expect(setting, "the switch is not declared").toBeTruthy();
        expect(setting?.default, "it arrives on, the way it always behaved").toBe(true);
    });
});

describe("a basket trades a rung in once", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("credits one unit of an upgrade, not every unit of it", () => {
        // An upgrade is one step. Five of the rung above is not five steps
        // from the one below it, and the credit used to be taken off each.
        const cart = priceCartLines(
            [{ productId: "vip-plus", categoryId: "ranks", price: 19.99, quantity: 5 }],
            new Set(["vip"]),
            [VIP],
        );
        expect(cart.lines[0].upgradeCredit).toBe(0);
        expect(cart.subtotal).toBeCloseTo(99.95, 5);

        const till = computeOrderPricing({
            items: [{ productId: "vip-plus", quantity: 5 }],
            products: [{ id: "vip-plus", name: "VIP+", price: 19.99, categoryId: "ranks" }],
            bulkDiscounts: [],
            ownedProductIds: new Set(["vip"]),
            ownedRungs: [VIP],
        });
        expect(till.subtotal).toBeCloseTo(99.95, 5);
    });

    it("trades the rung owned in on one line of the basket, not on each", () => {
        // VIP owned, VIP+ and MVP in one basket: the VIP was paid for once.
        const lines = [
            { productId: "vip-plus", categoryId: "ranks", price: 19.99, quantity: 1 },
            { productId: "mvp", categoryId: "ranks", price: 39.99, quantity: 1 },
        ];
        const cart = priceCartLines(lines, new Set(["vip"]), [VIP]);
        expect(cart.lines.map((line) => line.upgradeCredit)).toEqual([9.99, 0]);

        const till = computeOrderPricing({
            items: lines.map((line) => ({ productId: line.productId, quantity: 1 })),
            products: [
                { id: "vip-plus", name: "VIP+", price: 19.99, categoryId: "ranks" },
                { id: "mvp", name: "MVP", price: 39.99, categoryId: "ranks" },
            ],
            bulkDiscounts: [],
            ownedProductIds: new Set(["vip"]),
            ownedRungs: [VIP],
        });
        expect(till.subtotal).toBeCloseTo(cart.subtotal, 5);
        expect(till.subtotal).toBeCloseTo(10 + 39.99, 5);
    });

    it("counts only what was bought on a shelf drawn as a ladder", async () => {
        // A crate key bought last week is not a rung: the shelf of keys is a
        // grid, and the cheaper key used to be taken off the dearer one on
        // every order for as long as the account existed.
        ownedRows.mockResolvedValue([{ productId: "key" }, { productId: "vip" }]);
        ladderRows.mockResolvedValue([{ id: "vip" }]);

        expect([...(await creditingPurchases("user-1"))]).toEqual(["vip"]);
        expect(ladderRows.mock.calls[0][0]).toMatchObject({
            where: { id: { in: ["key", "vip"] }, category: { layout: "table" } },
        });
    });
});
