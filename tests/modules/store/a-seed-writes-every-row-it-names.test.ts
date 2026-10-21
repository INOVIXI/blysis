// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { join } from "node:path";
import { productSlug } from "@/modules/store/seed";

/**
 * The demo product names, read from the seed rather than copied here.
 *
 * Copying them would make this test pass forever while the shop grew a
 * sixteenth product that collides with the fifteenth. Exporting them from the
 * seed would leave the module carrying an export only a test calls, which the
 * panel has its own gate against.
 */
function productNames(): string[] {
    const src = fs.readFileSync(join(__dirname, "..", "..", "..", "module-sources/store/seed.ts"), "utf8");
    const list = src.slice(src.indexOf("const PRODUCTS"), src.indexOf("];", src.indexOf("const PRODUCTS")));
    return [...list.matchAll(/^\s*\["([^"]+)"/gm)].map((m) => m[1]);
}

/**
 * A seed that names fifteen products writes fifteen products.
 *
 * It did not. The slug was `name.toLowerCase().replace(/[^a-z0-9]+/g, "-")`
 * with the ends trimmed, so "VIP+" became "vip" and "MVP+" became "mvp" - the
 * slugs the tier below them already had. The seed skips a slug that exists,
 * because an existing slug is the operator's product rather than the tool's,
 * so the two upsell tiers were silently dropped every run while the log went
 * on reporting fifteen. One of them carried the only "one to an account,
 * ever" rule in the demo, which meant that branch was never on screen.
 *
 * The names are the fixture: whoever adds the sixteenth finds out here rather
 * than by counting cards in a shop.
 */
describe("a seed writes every row it names", () => {
    it("gives each demo product its own slug", () => {
        const names = productNames();
        expect(names.length).toBeGreaterThan(10);
        expect(new Set(names.map(productSlug)).size).toBe(names.length);
    });

    it("keeps a plus tier apart from the tier it upgrades", () => {
        expect(productSlug("VIP+")).not.toBe(productSlug("VIP"));
        expect(productSlug("MVP+")).toBe("mvp-plus");
    });

    it("still writes a plain name plainly", () => {
        expect(productSlug("Key bundle (10)")).toBe("key-bundle-10");
        expect(productSlug("Pet: baby dragon")).toBe("pet-baby-dragon");
    });
});
