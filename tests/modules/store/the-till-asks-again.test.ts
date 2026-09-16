// @vitest-environment node
/**
 * The checkout asks the same questions the button asked.
 *
 * A window, a per-person limit and a daily allowance are all enforced twice:
 * once where a shopper can see it, so they are told before they try, and once
 * at the till, because the first one runs in a browser and a browser is not
 * something a shop may rely on. `curl` skips the button.
 *
 * The prices work the same way. A scheduled sale changes what the shop shows;
 * a checkout that charged the column instead would take a different amount
 * from the one on the screen, which is the kind of difference a payment
 * provider settles and a customer disputes.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

const CHECKOUT = read("module-sources/store/api/checkout/route.ts");
const CART = read("module-sources/store/api/cart/route.ts");
const LIST = read("module-sources/store/api/products/route.ts");
/**
 * The product read, which both the page and the endpoint go through. The rules
 * used to be inside the endpoint; the page renders the product on the server
 * now, and two copies of "hide it while it is shut" would be one copy too
 * many.
 */
const DETAIL = read("module-sources/store/lib/read-product.ts");

describe("the checkout", () => {
    it("asks whether each product is for sale, for this person, now", () => {
        expect(CHECKOUT).toContain("availabilityFor(");
        expect(CHECKOUT).toContain("state.buyable");
    });

    it("refuses over a per-person limit and over the period's allowance", () => {
        expect(CHECKOUT).toContain("remainingForPerson");
        expect(CHECKOUT).toContain("remainingInPeriod");
    });

    it("charges the price the sale sets, not the column", () => {
        expect(CHECKOUT).toContain("effectivePrice(");
        expect(CHECKOUT).not.toMatch(/price: Number\(p\.price\),/);
    });

    it("reads the site's clock rather than the server's", () => {
        expect(CHECKOUT).toContain("siteTimeZone()");
    });
});

describe("the screens in front of it", () => {
    it("tell a shopper before they try", () => {
        expect(CART).toContain("availabilityFor(");
        expect(DETAIL).toContain("availabilityFor(");
    });

    it("hide a product an operator asked to hide while it is shut", () => {
        expect(LIST).toContain("hideShut(");
        // The detail answer for one of those is the same as for a product
        // that does not exist, so the two cannot be told apart.
        expect(DETAIL).toContain('outsideWindow === "hidden"');
        // The read says "nothing here" rather than answering itself, and both
        // callers turn that into not found - the endpoint with a 404, the page
        // with `notFound()`. Either way indistinguishable from a product that
        // was never there.
        expect(DETAIL).toMatch(/hidden[\s\S]{0,120}return null/);
        expect(read("module-sources/store/api/products/[id]/route.ts")).toMatch(/!product[\s\S]{0,120}Product not found/);
        expect(read("module-sources/store/pages/public/product/[...params]/page.tsx")).toMatch(/!read[\s\S]{0,40}notFound\(\)/);
    });

    it("carry the state and the sale to the page that draws them", () => {
        expect(LIST).toContain("availability:");
        expect(DETAIL).toContain("availability:");
        expect(LIST).toContain("effectivePrice(");
    });
});
