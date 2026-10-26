/**
 * A footer is grouped the way its modules say, and an operator can leave a
 * module's link out of it.
 *
 * Every module filed its footer link under `quick`, so a site's footer was
 * one column of every page, longer with each module installed, and an
 * operator who wrote columns of their own still had every unlisted module
 * link poured into the first one: the footer a design draws, three short
 * columns, could not be built. A module now names the section its link
 * belongs to in its own word, with the column's name in the reader's
 * language, and a footer nobody has arranged is drawn a column per section.
 * Whatever the site adds, a module's link or the way home, an operator may
 * hide, and show again from the same place.
 */
import { describe, it, expect } from "vitest";
import {
    defaultFooterColumns,
    drawnFooterColumns,
    parseHiddenLinks,
    type ModuleFooterLink,
} from "@/core/lib/footer-columns";
import { moduleManifestSchema } from "@/core/lib/module-manifest-schema";

const words = { home: "Home", moduleLink: () => null };

const MODULES: ModuleFooterLink[] = [
    { label: "Forum", href: "/forum", section: "community", sectionLabelKey: "section_community" },
    { label: "Store", href: "/store", section: "game", sectionLabelKey: "section_game" },
    { label: "Blog", href: "/blog", section: "community", sectionLabelKey: "section_community" },
    { label: "Old", href: "/old", section: "quick" },
];

const labels = (columns: ReturnType<typeof drawnFooterColumns>) =>
    columns.map((c) => `${c.title ?? c.titleKey}: ${c.links.map((l) => l.label).join(", ")}`);

describe("a footer nobody arranged", () => {
    it("has a column for each section its modules name, called what they call it", () => {
        const columns = defaultFooterColumns(null, null, MODULES);
        expect(columns.map((c) => [c.titleKey, c.section])).toEqual([
            ["quickLinks", null],
            ["legal", "legal"],
            ["section_community", "community"],
            ["section_game", "game"],
        ]);
    });

    it("draws each module's link under its section, and the rest where they always went", () => {
        const drawn = drawnFooterColumns(defaultFooterColumns(null, null, MODULES), MODULES, words)
            .filter((c) => c.links.length > 0);
        expect(labels(drawn)).toEqual([
            "quickLinks: Home, Old",
            "section_community: Forum, Blog",
            "section_game: Store",
        ]);
    });

    it("makes no column for a section a module names without saying what to call it", () => {
        const columns = defaultFooterColumns(null, null, [{ label: "Misc", href: "/misc", section: "misc" }]);
        expect(columns.map((c) => c.section)).toEqual([null, "legal"]);
    });
});

describe("the way home", () => {
    it("joins the first column with links in it when the catch-all has none", () => {
        const drawn = drawnFooterColumns([
            { title: "Play", titleKey: null, section: "game", links: [] },
            { title: "Empty", titleKey: null, section: null, links: [] },
        ], MODULES.slice(1, 2), words);
        expect(labels(drawn.filter((c) => c.links.length > 0))).toEqual(["Play: Home, Store"]);
    });
});

describe("a link the site adds", () => {
    it("is left out when the operator hid it, home included, and theirs never is", () => {
        const operator = [{ title: "Mine", titleKey: null, section: null, links: [{ label: "My blog", href: "/blog", external: false, icon: null, source: "operator" as const }] }];
        const drawn = drawnFooterColumns(
            [...operator, { title: "Talk", titleKey: null, section: "community", links: [] }],
            MODULES,
            words,
            ["/blog", "/forum", "/"],
        );
        expect(labels(drawn.filter((c) => c.links.length > 0))).toEqual(["Mine: My blog, Store, Old"]);
    });

    it("is hidden by its address, as the operator saved it", () => {
        expect(parseHiddenLinks(JSON.stringify(["/blog", " /forum ", 3, ""]))).toEqual(["/blog", "/forum"]);
        expect(parseHiddenLinks(["/x"])).toEqual(["/x"]);
        expect(parseHiddenLinks("not json")).toEqual([]);
        expect(parseHiddenLinks(undefined)).toEqual([]);
    });
});

describe("a module's footer link", () => {
    const manifest = (link: Record<string, unknown>) => ({
        id: "sample", name: "Sample", version: "1.0.0", coreVersion: ">=5.0.0", description: "A sample module.",
        footerLinks: [{ label: "Sample", href: "/sample", ...link }],
    });

    it("names its section in its own word, with a key for the column's name", () => {
        const parsed = moduleManifestSchema.safeParse(manifest({ section: "community", sectionLabelKey: "section_community" }));
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it("is refused a section that is not a word", () => {
        expect(moduleManifestSchema.safeParse(manifest({ section: "Not a word" })).success).toBe(false);
    });
});
