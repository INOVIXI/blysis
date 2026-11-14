/**
 * Copying a product, and the three things a copy must not inherit.
 *
 * An operator builds one rank carefully - the commands it runs, the fields
 * the buyer fills in, the hours it is on sale, who may buy it - and then
 * needs four more of it at four prices. Typing it out again is where the
 * fourth one loses a delivery command nobody notices until somebody pays.
 *
 * What makes this worth a test is not what is copied. It is what is not:
 *
 * - the copy is switched off, because a product that appears in the shop the
 *   instant it is made is one nobody has renamed or priced yet, and the
 *   window between the click and the edit is a real sale at the wrong price;
 * - it has sold nothing, because a copy inheriting the original's sales count
 *   ranks above products that really outsold it on the day it is made;
 * - it carries no processor price id. That id names a price object belonging
 *   to the original. Two products pointing at one of them means a refund on
 *   either looks like a refund on both.
 *
 * Everything an operator built by hand does come across, including the rows
 * held in other tables - the delivery commands and the buyer's fields - since
 * a copy that delivers nothing is the failure this feature exists to prevent.
 *
 * The copy's name comes from the caller rather than from here. A name is a
 * row a visitor reads, and the only place that knows which language to say
 * "copy" in is the screen the operator is looking at.
 */
import { describe, it, expect } from "vitest";
import { copyOf, freeSlug } from "@/modules/store/lib/clone-product";

const original = {
    id: "prod-1",
    name: "VIP",
    slug: "vip",
    translations: { tr: { name: "VIP" } },
    description: "<p>Everything a member gets, and more.</p>",
    shortDesc: "The middle rank",
    price: "10.00",
    comparePrice: "15.00",
    image: "/uploads/vip.png",
    images: ["/uploads/vip-2.png"],
    stock: 40,
    unitsSold: 812,
    isActive: true,
    isFeatured: true,
    type: "DIGITAL",
    deliveryData: { note: "keep" },
    commandsPerUnit: true,
    deliveryMode: "hold",
    subscriptionInterval: null,
    subscriptionIntervalCount: 1,
    stripePriceId: "price_abc123",
    availableFrom: new Date("2026-01-01T00:00:00Z"),
    availableUntil: null,
    availableDays: [5, 6],
    availableFromMinute: 1080,
    availableUntilMinute: 1380,
    outsideWindow: "hidden",
    roleIds: ["role-member"],
    perPersonLimit: 1,
    perPersonPeriod: "month",
    periodStock: 10,
    periodStockWindow: "day",
    durationDays: 30,
    grantsRoleId: "role-vip",
    requiresProductIds: ["prod-starter"],
    requiresAny: true,
    salePrice: "8.00",
    saleFrom: new Date("2026-02-01T00:00:00Z"),
    saleUntil: new Date("2026-02-08T00:00:00Z"),
    categoryId: "cat-ranks",
};

describe("a name for the copy", () => {
    it("takes the original's slug with a suffix when nothing is in the way", () => {
        expect(freeSlug("vip", new Set())).toBe("vip-copy");
    });

    it("counts up when the shop has been copied before", () => {
        expect(freeSlug("vip", new Set(["vip-copy"]))).toBe("vip-copy-2");
        expect(freeSlug("vip", new Set(["vip-copy", "vip-copy-2"]))).toBe("vip-copy-3");
    });

    it("does not stop at the first gap, because a slug is a name not a count", () => {
        // "vip-copy-2" deleted. The next copy is 4, not 2: reusing a freed
        // name hands the new product an old product's links.
        expect(freeSlug("vip", new Set(["vip-copy", "vip-copy-3"]))).toBe("vip-copy-4");
    });
});

describe("what a copied product is", () => {
    const copy = copyOf(original, { slug: "vip-copy", name: "VIP (copy)" });

    it("is switched off, whatever the original was", () => {
        expect(copy.isActive).toBe(false);
    });

    it("has sold nothing", () => {
        expect(copy.unitsSold).toBe(0);
    });

    it("carries no price id from the processor", () => {
        expect(copy.stripePriceId).toBeNull();
    });

    it("is not featured, because two of one thing on the front page is a mistake", () => {
        expect(copy.isFeatured).toBe(false);
    });

    it("has its own identity", () => {
        expect("id" in copy).toBe(false);
        expect("number" in copy).toBe(false);
        expect("createdAt" in copy).toBe(false);
        expect(copy.slug).toBe("vip-copy");
    });

    it("keeps every rule the operator set by hand", () => {
        expect(copy).toMatchObject({
            price: "10.00",
            comparePrice: "15.00",
            stock: 40,
            type: "DIGITAL",
            categoryId: "cat-ranks",
            durationDays: 30,
            grantsRoleId: "role-vip",
            roleIds: ["role-member"],
            requiresProductIds: ["prod-starter"],
            requiresAny: true,
            availableDays: [5, 6],
            availableFromMinute: 1080,
            availableUntilMinute: 1380,
            outsideWindow: "hidden",
            perPersonLimit: 1,
            perPersonPeriod: "month",
            periodStock: 10,
            periodStockWindow: "day",
            salePrice: "8.00",
            image: "/uploads/vip.png",
            images: ["/uploads/vip-2.png"],
            deliveryData: { note: "keep" },
            commandsPerUnit: true,
            deliveryMode: "hold",
            translations: { tr: { name: "VIP" } },
        });
        expect(copy.availableFrom).toEqual(original.availableFrom);
        expect(copy.saleUntil).toEqual(original.saleUntil);
    });

    it("takes a copy of the arrays rather than sharing them", () => {
        // Prisma is handed these directly. Sharing the array means editing
        // the copy's days later edits the original's row too.
        expect(copy.images).not.toBe(original.images);
        expect(copy.roleIds).not.toBe(original.roleIds);
        expect(copy.availableDays).not.toBe(original.availableDays);
        expect(copy.requiresProductIds).not.toBe(original.requiresProductIds);
    });

    it("is named by whoever asked for it, in their own language", () => {
        expect(copy.name).toBe("VIP (copy)");
        expect(copyOf(original, { slug: "vip-kopya", name: "VIP (kopya)" }).name).toBe("VIP (kopya)");
    });
});
