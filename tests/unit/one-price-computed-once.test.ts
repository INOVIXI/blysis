import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { computeCouponDiscount } from "../../module-sources/store/lib/pricing";

const STORE = path.join(process.cwd(), "module-sources/store");
const read = (p: string) => fs.readFileSync(path.join(STORE, p), "utf8");

/**
 * What a shopper is shown is what a shopper is charged.
 *
 * The store had two implementations of the same arithmetic. `lib/pricing.ts`
 * is the one the checkout charges by, and it caps a fixed-value coupon at the
 * subtotal: fifty off a ten-pound cart is ten, because a discount larger than
 * the order would have the shop paying the customer. The coupon preview had
 * its own copy of the rules and had never been given that cap, so the cart
 * promised fifty off and the till took ten. A preview that disagrees with the
 * till is worse than no preview.
 *
 * There were two order-creating routes as well. `POST /store/orders`, which
 * nothing called and the manifest described as the way an admin enters a
 * manual order, had no admin check, priced the order itself without the
 * rounding to whole cents, claimed a use of a capped coupon outside any
 * transaction and before the order it belonged to existed, and then created
 * the order and emptied the cart with no payment step at all. It is gone; the
 * checkout is the checkout.
 */

describe("a fixed coupon never exceeds the order it discounts", () => {
    const coupon = {
        isActive: true,
        type: "FIXED" as const,
        value: 50,
        usageCount: 0,
    };

    it("caps at the subtotal", () => {
        expect(computeCouponDiscount(coupon, 10).discount).toBe(10);
    });

    it("gives its face value when the order is larger", () => {
        expect(computeCouponDiscount(coupon, 120).discount).toBe(50);
    });

    it("gives nothing on an empty cart", () => {
        expect(computeCouponDiscount(coupon, 0).discount).toBe(0);
    });
});

describe("the preview is computed by the function that charges", () => {
    const validate = read("api/coupons/validate/route.ts");

    it("calls it", () => {
        expect(validate).toContain("computeCouponDiscount");
        expect(validate).toContain("../../../lib/pricing");
    });

    it("returns what it returned, unrounded a second time", () => {
        expect(validate).toContain("discount: priced.discount");
        expect(validate).not.toContain("Math.round(discount * 100)");
    });

    it("keeps no copy of the rules", () => {
        for (const rule of [
            "coupon.usageLimit && coupon.usageCount",
            "coupon.expiresAt && coupon.expiresAt <",
            "coupon.startsAt && coupon.startsAt >",
        ]) {
            expect(validate, rule).not.toContain(rule);
        }
    });

    it("still says nothing about why a coupon failed, beyond what a shopper can act on", () => {
        /*
         * The refusals are codes now, not English sentences: the page that
         * asks was throwing the sentences away, because a shopper reading
         * Turkish cannot be shown them. What the rule protects is unchanged -
         * a coupon that never existed and one that has run out answer the
         * same, so the response cannot be used to go looking for codes - and
         * it is the collapse to `coupon_unknown` that does it.
         */
        expect(validate).toContain("coupon_unknown");
        expect(validate).toContain("coupon_min_purchase");
        expect(validate).toContain("coupon_not_for_these_items");
        for (const hidden of ["coupon_expired", "coupon_not_started", "coupon_used_up"]) {
            expect(validate, `${hidden} must not be told apart`).not.toContain(`"${hidden}"`);
        }
    });
});

describe("the checkout is the only way an order is made", () => {
    it("the checkout creates orders", () => {
        expect(read("api/checkout/route.ts")).toMatch(/export async function POST/);
    });

    it("the orders route only lists them", () => {
        const orders = read("api/orders/route.ts");
        expect(orders).toMatch(/export async function GET/);
        expect(orders).not.toMatch(/export async function POST/);
    });

    it("no route outside the checkout adds up an order of its own", () => {
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.name.endsWith(".ts")) files.push(full);
            }
        };
        walk(path.join(STORE, "api"));

        const offenders = files.filter((file) => {
            if (file.endsWith(path.join("checkout", "route.ts"))) return false;
            return /subtotal\s*\+=/.test(fs.readFileSync(file, "utf8"));
        });
        expect(offenders.map((f) => path.relative(STORE, f))).toEqual([]);
    });

    it("says so in the manifest, which used to advertise the route that is gone", () => {
        const manifest = JSON.parse(read("module.json"));
        const orders = manifest.api.find((a: { path: string }) => a.path === "/store/orders");
        expect(orders.description).not.toContain("create a new order");
        expect(orders.description).toContain("/store/checkout");
    });
});
