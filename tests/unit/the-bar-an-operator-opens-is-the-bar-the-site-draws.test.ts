// @vitest-environment node
/**
 * The navbar an operator opens to edit is the navbar the site is drawing.
 *
 * The bar folds its tail: past eight links the rest go under "More", because
 * a site with nine modules installed has nine links and a bar cannot hold
 * them. That fold was a branch at render time, and the only condition on it
 * was that nobody had saved a navbar yet.
 *
 * The editor seeded itself from the registry instead - every link, flat, no
 * fold. So an operator opened it, saw a different bar from the one on their
 * own site, pressed Save to change one label, and the fold was gone: nine
 * links inline and a bar that overflows, with no way back except building the
 * dropdown by hand.
 *
 * One function decides the shape now, and both the bar and the editor ask it.
 * A fold that is saved is data like any other link, and stays editable.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { foldNavLinks, INLINE_NAV_LINKS } from "@/core/lib/navbar-links";

const link = (n: number) => ({ label: `Link ${n}`, labelKey: `nav_${n}`, href: `/l${n}`, icon: "Package" });
const many = (count: number) => Array.from({ length: count }, (_, i) => link(i + 1));

describe("a bar that fits", () => {
    it("is left alone", () => {
        const links = many(INLINE_NAV_LINKS);
        expect(foldNavLinks(links, "More")).toEqual(links);
    });

    it("is left alone when it is one short of full", () => {
        const links = many(INLINE_NAV_LINKS - 1);
        expect(foldNavLinks(links, "More")).toHaveLength(INLINE_NAV_LINKS - 1);
    });
});

describe("a bar that does not fit", () => {
    const folded = foldNavLinks(many(INLINE_NAV_LINKS + 3), "More");

    it("keeps what fits and folds the rest under one entry", () => {
        expect(folded).toHaveLength(INLINE_NAV_LINKS + 1);
        expect(folded.at(-1)?.children).toHaveLength(3);
    });

    it("names the fold in the word it was given, not in English", () => {
        expect(foldNavLinks(many(20), "Daha fazla").at(-1)?.label).toBe("Daha fazla");
    });

    it("keeps each folded link's own translation key", () => {
        // A fold that is saved becomes the operator's navbar, and a link
        // inside it that lost its key would be frozen in whichever language
        // the operator happened to be reading when they pressed Save.
        expect(folded.at(-1)?.children?.[0]?.labelKey).toBe(`nav_${INLINE_NAV_LINKS + 1}`);
    });

    it("folds once, however many times it is asked", () => {
        expect(foldNavLinks(folded, "More")).toEqual(folded);
    });
});

describe("the two screens that draw it", () => {
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

    it("both ask the one function", () => {
        expect(read("src/core/components/layout/Navbar.tsx")).toContain("foldNavLinks");
        expect(read("src/app/[locale]/(admin)/admin/settings/navbar/page.tsx")).toContain("foldNavLinks");
    });

    it("writes no English into an operator's own navbar", () => {
        // `addDropdown` wrote `label: "More"` into the saved rows, so a
        // Turkish site got an English word in its own bar.
        const editor = read("src/app/[locale]/(admin)/admin/settings/navbar/page.tsx");
        expect(editor).not.toContain('label: "More"');
    });
});

describe("what the editor shows beside a stored label", () => {
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

    it("says what a visitor reads, where the two differ", () => {
        /*
         * A module's link is stored as its own English name with a
         * translation key beside it, and the box holds what is stored -
         * typing in it is the operator's own word and drops the key, so it
         * cannot simply show the translation. The screen said "Store" where
         * the site says "Magaza", and an operator had no way to know the two
         * were the same link.
         */
        const editor = read("src/app/[locale]/(admin)/admin/settings/navbar/page.tsx");
        expect(editor).toContain("navbar_visitorsSee");
        for (const locale of ["en", "tr"]) {
            const core = JSON.parse(read(`messages-core/${locale}.json`));
            expect(typeof core.admin.navbar_visitorsSee, locale).toBe("string");
        }
    });
});
