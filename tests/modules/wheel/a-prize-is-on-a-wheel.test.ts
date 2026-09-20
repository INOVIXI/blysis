// @vitest-environment node
/**
 * A prize is on a wheel, and says which one.
 *
 * The model is built for several wheels - a free daily one, a weekly one for
 * people who bought a rank, one that costs credits - and the screen that
 * writes prizes could not say which of them a prize was for. It had no wheel
 * field at all, so every prize an operator wrote joined whichever wheel came
 * first, and the update route never read `wheelId`, so nothing could move it
 * afterwards. A site with three wheels could fill exactly one of them, and
 * the operator was not told which.
 *
 * The odds were sold as something they are not. The box said "Probability
 * (1-100)" and the draw sums the numbers and takes a share: three prizes at
 * 100 are not certain three times over, they are a third each. So the screen
 * says the share, which is the number an operator is actually setting.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prizeChance, drawPrize, prizeIsGrantable } from "@/modules/wheel/lib/wheels";

const PRIZES = [
    { id: "a", name: "Ten credits", probability: 100, isActive: true },
    { id: "b", name: "A coupon", probability: 100, isActive: true },
    { id: "c", name: "Nothing", probability: 100, isActive: true },
];

describe("the chance a prize comes up", () => {
    it("is its share of the odds on the wheel, not the number in the box", () => {
        expect(prizeChance(PRIZES, PRIZES[0])).toBeCloseTo(33.33, 1);
    });

    it("is what it looks like when the numbers already add to a hundred", () => {
        const tidy = [
            { id: "a", probability: 70, isActive: true },
            { id: "b", probability: 30, isActive: true },
        ];
        expect(prizeChance(tidy, tidy[0])).toBe(70);
    });

    it("is nothing for a prize an operator switched off", () => {
        const off = [...PRIZES, { id: "d", probability: 100, isActive: false }];
        expect(prizeChance(off, off[3])).toBe(0);
        // And it is not counted against the others either.
        expect(prizeChance(off, off[0])).toBeCloseTo(33.33, 1);
    });

    it("is nothing where every prize has odds of zero", () => {
        const none = [{ id: "a", probability: 0, isActive: true }];
        expect(prizeChance(none, none[0])).toBe(0);
        expect(drawPrize(none, () => 0)).toBeNull();
    });

    it("agrees with the draw over many turns", () => {
        // A crude check that the number on the screen is the number the wheel
        // behaves like: roll the middle of each slice and count where it lands.
        const counts = new Map<string, number>();
        for (let i = 0; i < 300; i++) {
            const won = drawPrize(PRIZES, (max) => Math.floor((i / 300) * max));
            counts.set(won!.id, (counts.get(won!.id) ?? 0) + 1);
        }
        for (const prize of PRIZES) {
            expect((counts.get(prize.id) ?? 0) / 3).toBeCloseTo(prizeChance(PRIZES, prize), 0);
        }
    });
});

describe("the screen that writes a prize", () => {
    const read = (rel: string) =>
        fs.readFileSync(path.join(process.cwd(), "module-sources/wheel", rel), "utf8");
    const manifest = () => JSON.parse(read("module.json"));

    it("asks which wheel the prize is on", () => {
        const form = read("pages/admin/prizes/page.tsx");
        expect(form).toContain("wheelId");
        expect(form).toContain("reference");
    });

    it("says which wheel a prize is on, and what it pays, in words", () => {
        const form = read("pages/admin/prizes/page.tsx");
        // The row drew the raw column: "credits", "coupon", "nothing".
        expect(form).not.toContain('secondaryField="type"');
        expect(form).toContain("adm_prizeRow");
    });

    it("lets a prize be moved to another wheel", () => {
        expect(read("api/prizes/[id]/route.ts")).toContain("wheelId");
    });

    it("stops calling the odds a percentage in the box", () => {
        const translations = manifest().translations;
        for (const locale of ["en", "tr"]) {
            const wheel = translations[locale].wheel;
            expect(wheel.adm_field3Placeholder, `${locale} odds placeholder`).not.toMatch(/1-100|1–100/);
            expect(typeof wheel.adm_prizeRow, `${locale} adm_prizeRow`).toBe("string");
            expect(typeof wheel.adm_wheelLabel, `${locale} adm_wheelLabel`).toBe("string");
        }
    });
});

describe("a prize the wheel cannot hand over", () => {
    /*
     * The spin grants credits and mints a coupon. Anything else is drawn,
     * written to the spin log, announced in the public feed and notified to
     * the winner, who receives nothing. The demo ships four of them - three
     * keys and a week of VIP, all of kind `item`.
     */
    it("is not one of the kinds the wheel can grant", () => {
        expect(prizeIsGrantable("credits")).toBe(true);
        expect(prizeIsGrantable("coupon")).toBe(true);
        expect(prizeIsGrantable("nothing")).toBe(true);
        expect(prizeIsGrantable("item")).toBe(false);
    });

    it("is said so on the row, rather than drawn as a kind of prize", () => {
        const form = fs.readFileSync(
            path.join(process.cwd(), "module-sources/wheel/pages/admin/prizes/page.tsx"), "utf8");
        expect(form).toContain("prizeIsGrantable");
        expect(form).toContain("adm_prizeUnbound");
    });

    it("is only what the spin route actually honours", () => {
        // The list and the till have to agree, so the list is read from the
        // one place and the till is checked against it here.
        const spin = fs.readFileSync(
            path.join(process.cwd(), "module-sources/wheel/api/spin/route.ts"), "utf8");
        expect(spin).toContain('selectedPrize.type === "credits"');
        expect(spin).toContain('selectedPrize.type === "coupon"');
        expect(spin).not.toContain('selectedPrize.type === "item"');
    });
});
