// @vitest-environment node
/**
 * A prize the wheel cannot hand over is not a prize.
 *
 * The spin route granted credits and minted a coupon and did nothing at all
 * for any other kind. The demo shipped four prizes of kind `item` - three
 * crate keys and a week of VIP - and every one of them was drawn, written to
 * the spin log, announced in the public activity feed and notified to the
 * winner, who received nothing. Somebody turning a wheel and being told they
 * won a Legendary Key had won a Legendary Key.
 *
 * A prize of kind `product` says what it hands over as an id it never reads.
 * Whoever owns the thing answers `product.grant` on the spin's own
 * transaction, so the turn and the thing commit together, and answers
 * `grantable.options` so an operator has a list to pick from. The wheel keeps
 * knowing nothing about what a crate key is, which is why it could not hand
 * one over in the first place.
 *
 * A refusal undoes the turn. A thing an operator has since taken down cannot
 * be given, and the fairest answer then is that the turn did not happen -
 * rather than a spin row recording a prize nobody received, which is the
 * state this whole change is about.
 */
import { describe, it, expect } from "vitest";
import {
    GRANTABLE_PRIZE_KINDS,
    prizeHandsSomethingOver,
    prizeIsGrantable,
} from "@/modules/wheel/lib/wheels";

describe("the kinds a wheel can hand over", () => {
    it("include the one that asks another module", () => {
        expect(GRANTABLE_PRIZE_KINDS).toContain("product");
    });

    it("still exclude a kind nothing answers", () => {
        expect(prizeIsGrantable("item")).toBe(false);
        expect(prizeIsGrantable("mystery-box")).toBe(false);
    });
});

describe("whether a row will actually give somebody something", () => {
    it("is yes for credits and a discount", () => {
        expect(prizeHandsSomethingOver({ type: "credits" })).toBe(true);
        expect(prizeHandsSomethingOver({ type: "coupon" })).toBe(true);
    });

    it("is yes for a thing once one has been picked", () => {
        expect(prizeHandsSomethingOver({ type: "product", productId: "p1" })).toBe(true);
    });

    it("is no for a thing nobody picked, which is the same promise unkept", () => {
        expect(prizeHandsSomethingOver({ type: "product", productId: null })).toBe(false);
        expect(prizeHandsSomethingOver({ type: "product" })).toBe(false);
    });

    it("is no for a kind nothing grants", () => {
        expect(prizeHandsSomethingOver({ type: "item", productId: "p1" })).toBe(false);
    });

    it("is yes for the kind that promises nothing, because it keeps that", () => {
        // `nothing` is a prize an operator wrote on purpose: a slice that
        // says better luck next time. The wheel honours it exactly, which is
        // the opposite of a kind it cannot honour at all.
        expect(prizeHandsSomethingOver({ type: "nothing" })).toBe(true);
    });
});
