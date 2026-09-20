import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { upgradeCredit, priceAfterCredit } from "@/modules/store/lib/upgrade-credit";

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
        // Either by asking directly or through `cart-pricing.ts`, which is
        // the same question wrapped: the cart screen and the coupon preview
        // both need the basket's worth and were working it out apart.
        const missing = asks.filter((file) => {
            const source = fs.readFileSync(path.join(ROOT, file), "utf8");
            return !source.includes("upgradeCredit(") && !source.includes("priceCartLines(");
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
