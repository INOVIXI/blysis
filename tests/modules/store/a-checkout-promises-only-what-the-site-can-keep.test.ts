import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { locales } from "@/core/lib/i18n/config";

/**
 * The cart says nothing about safety that the site cannot stand behind.
 *
 * Under the checkout button the cart told every shopper "Secure checkout", in
 * all twelve languages. A fresh install is served as `http://<ip>:<port>` for
 * weeks, so the page saying it was carried in the clear, and what happens
 * after the button is the gateway's: some redirect to a provider, a free order
 * or a balance payment never leaves the site. No sentence is true of all of
 * them, so the cart makes no such claim.
 */

const STORE = JSON.parse(readFileSync(join(__dirname, "../../../module-sources/store/module.json"), "utf8")) as {
    translations: Record<string, { store: Record<string, unknown> }>;
};

/** "Secure" as the twelve locales said it on the cart. */
const SECURE = /secure|güvenli|təhlükəsiz|sicher|segur|turvaline|sécurisé|sicura|bezpieczn|безопасн|安全/i;

describe("a checkout promises only what the site can keep", () => {
    it("reads every locale", () => {
        expect(Object.keys(STORE.translations).sort()).toEqual([...locales].sort());
    });

    for (const locale of locales) {
        it(`no shopper-facing string in ${locale} calls the checkout secure`, () => {
            const claims = Object.entries(STORE.translations[locale].store)
                .filter(([key, value]) => /checkout/i.test(key) && typeof value === "string" && SECURE.test(value));
            expect(claims).toEqual([]);
        });
    }
});
