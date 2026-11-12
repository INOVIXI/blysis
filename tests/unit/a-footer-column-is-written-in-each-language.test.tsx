// @vitest-environment jsdom
/**
 * A footer column's heading and the operator's own link labels may be
 * written per language, the way the navbar's are.
 *
 * Phase one translated the footer's about line and copyright and left the
 * columns one value, so a Turkish footer with English readers still headed
 * its columns in Turkish. A heading or a label is now a string or
 * `{ default, en, ... }`; the footer reads it in the reader's language and
 * in the original where theirs has nothing, and the editor gets every
 * language back to edit.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { parseFooterColumns } from "@/core/lib/footer-columns";

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/core/hooks/useSiteSettings", () => ({ useSiteSettings: () => ({ settings: settings.value, loaded: true }) }));
vi.mock("@/core/providers/module-provider", () => ({ useAllModules: () => ({}) }));
vi.mock("@/core/generated/module-registry", () => ({ ModuleFooterLinks: [] }));

const { useFooter } = await import("@/core/hooks/useFooter");

const COLUMNS = [
    {
        title: { default: "Topluluk", en: "Community", de: "  " },
        links: [
            { label: { default: "Kurallar", en: "Rules" }, href: "/page/rules" },
            { label: "Discord", href: "https://discord.example" },
        ],
    },
    { title: "Yasal", links: [{ label: { default: "Gizlilik", de: "Datenschutz" }, href: "/privacy" }] },
];

describe("a column the operator wrote per language", () => {
    it("is parsed in the reader's language, and in the original where theirs has nothing", () => {
        const en = parseFooterColumns(COLUMNS, "en");
        expect(en?.map((c) => c.title)).toEqual(["Community", "Yasal"]);
        expect(en?.[0].links.map((l) => l.label)).toEqual(["Rules", "Discord"]);

        const de = parseFooterColumns(COLUMNS, "de");
        expect(de?.map((c) => c.title)).toEqual(["Topluluk", "Yasal"]);
        expect(de?.[1].links[0].label).toBe("Datenschutz");

        expect(parseFooterColumns(COLUMNS)?.map((c) => c.title)).toEqual(["Topluluk", "Yasal"]);
    });

    it("hands the editor every language it holds", () => {
        const parsed = parseFooterColumns(COLUMNS);
        expect(parsed?.[0].titleText).toEqual({ default: "Topluluk", en: "Community" });
        expect(parsed?.[0].links[0].labelText).toEqual({ default: "Kurallar", en: "Rules" });
        // One string is `label` itself, and the parse stays the shape it was.
        expect(parsed?.[0].links[1].labelText).toBeUndefined();
        expect(parsed?.[1].titleText).toBeUndefined();
    });

    it("drops a heading or a link whose original is empty, whatever its translations say", () => {
        const parsed = parseFooterColumns([
            { title: { default: " ", en: "Ghost" }, links: [] },
            { title: "Var", links: [{ label: { default: "", en: "Ghost" }, href: "/x" }] },
        ], "en");
        expect(parsed).toHaveLength(1);
        expect(parsed?.[0].links).toEqual([]);
    });
});

function Columns() {
    const footer = useFooter();
    return <p>{footer.columns.map((c) => `${c.title}:${c.links.map((l) => l.label).join(",")}`).join("|")}</p>;
}

function draw(locale: string) {
    const tree = (
        <NextIntlClientProvider locale={locale} messages={{ common: { home: "Home" }, footer: {}, nav: {} }}>
            <Columns />
        </NextIntlClientProvider>
    );
    const served = new DOMParser().parseFromString(renderToString(tree), "text/html").body.textContent ?? "";
    const { container, unmount } = render(tree);
    const settled = container.textContent ?? "";
    unmount();
    return { served, settled };
}

describe("the footer a reader is drawn", () => {
    settings.value = { footer_columns: COLUMNS };

    it("heads and labels its columns in the reader's language, and the original where it has none", () => {
        expect(draw("tr").settled).toBe("Topluluk:Home,Kurallar,Discord|Yasal:Gizlilik");
        expect(draw("en").settled).toBe("Community:Home,Rules,Discord|Yasal:Gizlilik");
        expect(draw("de").settled).toBe("Topluluk:Home,Kurallar,Discord|Yasal:Datenschutz");
    });

    it("is the same on the server as in the browser", () => {
        for (const locale of ["tr", "en", "de"]) {
            const { served, settled } = draw(locale);
            expect(served, locale).toBe(settled);
        }
    });
});
