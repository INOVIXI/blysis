// @vitest-environment jsdom
/**
 * The footer an operator opens to edit is the footer the site is drawing.
 *
 * Measured on 2026-09-20 against this tree. No `footer_columns` row exists in
 * the settings table, so the editor showed the two legacy columns - "Quick
 * Links" and "Legal" - with no links in either, and said as much. The site's
 * own footer at the same moment carried nine: the way home and one for every
 * installed module, because the footer composes those at render time and the
 * editor did not.
 *
 * So the screen an operator opens to change their footer showed an empty
 * footer, and the section box - the field that decides which column adopts a
 * module's links - had no feedback at all. An operator could type a section
 * name and watch nothing happen.
 *
 * `drawnFooterColumns` is the composition, and both screens ask it. What a
 * module contributes is shown where it will land and is not editable there,
 * because it is not the operator's to edit and saving it would freeze a
 * module's own name into the operator's footer.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

import { drawnFooterColumns, legacyColumns, type FooterColumn } from "@/core/lib/footer-columns";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const EN = JSON.parse(read("messages-core/en.json"));

vi.mock("@/core/generated/module-registry", () => ({
    ModuleFooterLinks: [
        { label: "Forum", labelKey: "forum", href: "/forum", section: "quick", module: "forum" },
        { label: "Terms", href: "/terms", section: "legal", module: "legal-pages" },
    ],
}));

vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    useRouter: () => ({ push: () => {} }),
    usePathname: () => "/admin/settings/footer",
}));

vi.mock("@/core/providers/module-provider", () => ({
    useAllModules: () => ({}),
}));

vi.mock("@/core/hooks/useSiteSettings", () => ({
    invalidateSettingsCache: () => {},
}));

vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

const written: Record<string, unknown>[] = [];

beforeEach(() => {
    written.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
            written.push(JSON.parse(String(init.body)));
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ settings: {}, secretsConfigured: [] }), { status: 200 });
    }));
});

const { default: FooterSettingsPage } = await import(
    "@/app/[locale]/(admin)/admin/settings/footer/page"
);

async function open() {
    render(
        <NextIntlClientProvider locale="en" messages={EN}>
            <FooterSettingsPage />
        </NextIntlClientProvider>,
    );
    // The screen reads the settings once; the columns arrive after it.
    return await screen.findAllByRole("list", { name: EN.admin.footer_alsoDrawn });
}

describe("what the editor shows beside an operator's own links", () => {
    it("shows the links an installed module puts in that column", async () => {
        const lists = await open();
        expect(within(lists[0]).getByText("Forum")).toBeTruthy();
    });

    it("shows the way home, which core adds when nothing points at the front page", async () => {
        const lists = await open();
        expect(within(lists[0]).getByText(EN.common.home)).toBeTruthy();
    });

    it("shows a module's link in the column that claims its section", async () => {
        const lists = await open();
        expect(within(lists[1]).getByText("Terms")).toBeTruthy();
        expect(within(lists[0]).queryByText("Terms")).toBeNull();
    });

    it("does not offer them as boxes an operator can type in", async () => {
        const lists = await open();
        expect(within(lists[0]).queryAllByRole("textbox")).toHaveLength(0);
    });
});

describe("what the editor saves", () => {
    it("writes none of the module's links into the operator's own columns", async () => {
        await open();
        (await screen.findByText(EN.admin.footer_save)).click();
        await waitFor(() => expect(written).toHaveLength(1));
        const columns = written[0].footer_columns as { links: unknown[] }[];
        expect(columns.flatMap((column) => column.links)).toEqual([]);
    });
});

describe("the composition itself", () => {
    const words = { home: "Home", moduleLink: () => null };
    const moduleLinks = [
        { label: "Forum", labelKey: "forum", href: "/forum", section: "quick" },
        { label: "Terms", href: "/terms", section: "legal" },
    ];

    it("says who put each link in a column", () => {
        const own: FooterColumn[] = [
            { title: "Quick", titleKey: null, section: null, links: [{ label: "Mine", href: "/mine", external: false, icon: null, source: "operator" }] },
            { title: "Legal", titleKey: null, section: "legal", links: [] },
        ];
        const drawn = drawnFooterColumns(own, moduleLinks, words);
        expect(drawn[0].links.map((link) => [link.label, link.source])).toEqual([
            ["Home", "home"],
            ["Mine", "operator"],
            ["Forum", "module"],
        ]);
        expect(drawn[1].links.map((link) => [link.label, link.source])).toEqual([["Terms", "module"]]);
    });

    it("calls a module's link what the reader's own catalogue calls it", () => {
        const drawn = drawnFooterColumns(legacyColumns(null, null), moduleLinks, {
            home: "Ana Sayfa",
            moduleLink: (key) => (key === "forum" ? "Forum Alani" : null),
        });
        expect(drawn[0].links.map((link) => link.label)).toEqual(["Ana Sayfa", "Forum Alani"]);
    });

    it("falls back to the module's own name where the catalogue has none", () => {
        const drawn = drawnFooterColumns(legacyColumns(null, null), moduleLinks, words);
        expect(drawn[1].links.map((link) => link.label)).toEqual(["Terms"]);
    });
});

describe("the two screens that draw it", () => {
    it("both ask the one function", () => {
        expect(read("src/core/components/layout/Footer.tsx")).toContain("drawnFooterColumns");
        expect(read("src/app/[locale]/(admin)/admin/settings/footer/page.tsx")).toContain("drawnFooterColumns");
    });

    it("names what a module contributed, in both languages", () => {
        for (const locale of ["en", "tr"]) {
            const core = JSON.parse(read(`messages-core/${locale}.json`));
            expect(typeof core.admin.footer_alsoDrawn, locale).toBe("string");
        }
    });
});
