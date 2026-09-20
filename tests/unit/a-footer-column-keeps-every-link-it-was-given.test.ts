/**
 * The footer is columns an operator names, and nothing put in it disappears.
 *
 * Core used to render two fixed columns, "Quick Links" and "Legal", filled
 * from two free-form JSON settings. A module contributes footer links and
 * declares which section they belong to, and that section is the module's own
 * word - core cannot know the list. The first version of that filter kept
 * `section === "quick"` and silently swallowed every other one, which is the
 * failure this file exists to make impossible: a link the operator or a
 * module supplied is placed somewhere, always, even when no column claims it.
 *
 * With operator-named columns the same trap is one typo away. A column
 * declares which section it adopts; a link whose section nothing adopts joins
 * the catch-all, and when there are no columns at all one is made rather than
 * the links being dropped.
 *
 * The old settings keys still hold a live footer on every install that has
 * not opened the new screen, so they are read as columns rather than
 * migrated: nothing has to run for an install to keep the footer it had.
 */
import { describe, it, expect } from "vitest";
import {
    legacyColumns,
    parseFooterColumns,
    placeModuleLinks,
    withHomeLink,
    type FooterColumn,
} from "@/core/lib/footer-columns";

const moduleLink = (label: string, section: string | null) => ({
    label,
    href: `/${label.toLowerCase()}`,
    section,
});

const columnOf = (columns: FooterColumn[], title: string) =>
    columns.find((column) => column.title === title);

describe("reading the columns an operator saved", () => {
    it("says nothing was ever configured when the setting is absent", () => {
        expect(parseFooterColumns(undefined)).toBeNull();
        expect(parseFooterColumns("")).toBeNull();
        expect(parseFooterColumns({ not: "an array" })).toBeNull();
    });

    it("reads an empty list as a deliberately empty footer", () => {
        expect(parseFooterColumns([])).toEqual([]);
    });

    it("keeps a column's title, its section and its links", () => {
        const columns = parseFooterColumns([
            { title: "Help", section: "support", links: [{ label: "Contact", href: "/contact", icon: "mail" }] },
        ]);
        expect(columns).toEqual([
            {
                title: "Help",
                titleKey: null,
                section: "support",
                links: [{ label: "Contact", href: "/contact", external: false, icon: "mail", source: "operator" }],
            },
        ]);
    });

    it("drops a link whose address a browser would not follow", () => {
        const columns = parseFooterColumns([
            {
                title: "Help",
                links: [
                    { label: "Bad", href: "javascript:alert(1)" },
                    { label: "Good", href: "https://example.com" },
                ],
            },
        ]);
        expect(columns?.[0].links.map((l) => l.label)).toEqual(["Good"]);
        expect(columns?.[0].links[0].external).toBe(true);
    });

    it("drops a column with no title rather than rendering a headless list", () => {
        expect(parseFooterColumns([{ title: "   ", links: [{ label: "A", href: "/a" }] }])).toEqual([]);
    });
});

describe("an install that has never opened the new screen", () => {
    it("keeps the two columns it had, from the settings it had", () => {
        const columns = legacyColumns(
            '[{"label":"Store","href":"/store"}]',
            '[{"label":"Terms","href":"/terms"}]',
        );
        expect(columns.map((c) => c.titleKey)).toEqual(["quickLinks", "legal"]);
        expect(columns[0].links.map((l) => l.label)).toEqual(["Store"]);
        expect(columns[1].links.map((l) => l.label)).toEqual(["Terms"]);
    });

    it("makes the first column the catch-all and the second claim the legal section", () => {
        const columns = legacyColumns(null, null);
        expect(columns[0].section).toBeNull();
        expect(columns[1].section).toBe("legal");
    });
});

describe("where a module's link ends up", () => {
    const columns: FooterColumn[] = [
        { title: "Quick", titleKey: null, section: null, links: [] },
        { title: "Legal", titleKey: null, section: "legal", links: [] },
        { title: "Help", titleKey: null, section: "support", links: [] },
    ];

    it("joins the column that claims its section", () => {
        const placed = placeModuleLinks(columns, [moduleLink("Terms", "legal")]);
        expect(columnOf(placed, "Legal")?.links.map((l) => l.label)).toEqual(["Terms"]);
        expect(columnOf(placed, "Quick")?.links).toEqual([]);
    });

    it("joins the catch-all when no column claims its section", () => {
        const placed = placeModuleLinks(columns, [moduleLink("Servers", "resources")]);
        expect(columnOf(placed, "Quick")?.links.map((l) => l.label)).toEqual(["Servers"]);
    });

    it("joins the catch-all when it declares no section at all", () => {
        const placed = placeModuleLinks(columns, [moduleLink("Blog", null)]);
        expect(columnOf(placed, "Quick")?.links.map((l) => l.label)).toEqual(["Blog"]);
    });

    it("falls to the first column when the operator left no catch-all", () => {
        const claimed: FooterColumn[] = [
            { title: "Legal", titleKey: null, section: "legal", links: [] },
            { title: "Help", titleKey: null, section: "support", links: [] },
        ];
        const placed = placeModuleLinks(claimed, [moduleLink("Servers", "resources")]);
        expect(columnOf(placed, "Legal")?.links.map((l) => l.label)).toEqual(["Servers"]);
    });

    it("makes a column rather than dropping the links when there are none", () => {
        const placed = placeModuleLinks([], [moduleLink("Servers", "resources")]);
        expect(placed).toHaveLength(1);
        expect(placed[0].titleKey).toBe("quickLinks");
        expect(placed[0].links.map((l) => l.label)).toEqual(["Servers"]);
    });

    it("places every link exactly once, whatever its section says", () => {
        const links = [
            moduleLink("Terms", "legal"),
            moduleLink("Servers", "resources"),
            moduleLink("Contact", "support"),
            moduleLink("Blog", null),
        ];
        const placed = placeModuleLinks(columns, links);
        const landed = placed.flatMap((column) => column.links.map((l) => l.label));
        expect(landed.sort()).toEqual(["Blog", "Contact", "Servers", "Terms"]);
    });

    it("leaves the operator's own links in front of the module's", () => {
        const withOwn: FooterColumn[] = [
            { title: "Quick", titleKey: null, section: null, links: [{ label: "Mine", href: "/mine", external: false, icon: null, source: "operator" }] },
        ];
        const placed = placeModuleLinks(withOwn, [moduleLink("Theirs", null)]);
        expect(placed[0].links.map((l) => l.label)).toEqual(["Mine", "Theirs"]);
    });

    it("does not write into the columns it was given", () => {
        placeModuleLinks(columns, [moduleLink("Terms", "legal")]);
        expect(columns[1].links).toEqual([]);
    });
});

describe("the way home", () => {
    it("is the first link of the catch-all column", () => {
        const columns: FooterColumn[] = [
            { title: "Legal", titleKey: null, section: "legal", links: [] },
            { title: "Quick", titleKey: null, section: null, links: [{ label: "Store", href: "/store", external: false, icon: null, source: "operator" }] },
        ];
        const shown = withHomeLink(columns, "Home");
        expect(columnOf(shown, "Quick")?.links.map((l) => l.href)).toEqual(["/", "/store"]);
        expect(columnOf(shown, "Legal")?.links).toEqual([]);
    });

    it("is there even when an operator emptied every column", () => {
        const shown = withHomeLink([], "Home");
        expect(shown).toHaveLength(1);
        expect(shown[0].links.map((l) => l.href)).toEqual(["/"]);
    });

    it("is not added twice when a column already links to the front page", () => {
        const columns: FooterColumn[] = [
            { title: "Quick", titleKey: null, section: null, links: [{ label: "Front", href: "/", external: false, icon: null, source: "operator" }] },
        ];
        expect(withHomeLink(columns, "Home")[0].links.map((l) => l.label)).toEqual(["Front"]);
    });
});
