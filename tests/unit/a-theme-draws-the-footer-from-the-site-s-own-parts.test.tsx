// @vitest-environment jsdom
/**
 * A theme can draw its own footer out of the same parts core draws its own.
 *
 * Kite's approved footer puts the language and a day-or-night switch on the
 * line under the columns. Core's footer is one block: a theme could recolour
 * it but not move anything in it, and a theme that drew its own lost the
 * operator's columns, the modules' links and controls, and the slot modules
 * draw into, because none of them were offered. Now they are: the content as
 * data, the language as a choice, the modules' controls and the credit as
 * components, and the slot is handed to whatever footer is drawn.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({
    settings: {} as Record<string, unknown>,
    overrides: {} as Record<string, React.ComponentType<Record<string, unknown>>>,
    replace: vi.fn(),
}));

vi.mock("@/core/generated/module-registry", () => ({
    ModuleFooterLinks: [{ label: "Forum", labelKey: "forum", href: "/forum", section: "quick", module: "forum" }],
    ModuleFooterComponents: [{ id: "currency", module: "store", order: 1 }],
}));
vi.mock("@/core/generated/module-components", () => ({
    FooterComponentRegistry: { currency: () => <span>USD</span> },
}));
vi.mock("@/core/providers/module-provider", () => ({ useAllModules: () => ({}) }));
vi.mock("@/core/hooks/useSiteSettings", () => ({ useSiteSettings: () => ({ settings: state.settings }) }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
    useRouter: () => ({ replace: state.replace }),
    usePathname: () => "/store",
}));
vi.mock("@/core/providers/theme-provider", () => ({ useTheme: () => ({ activeTheme: { id: "test-theme" } }) }));
vi.mock("@/core/generated/theme-components", () => ({
    getThemeComponent: (_theme: string, name: string) => state.overrides[name] ?? null,
}));
vi.mock("@/core/components/Slot", () => ({ Slot: ({ name }: { name: string }) => <div data-slot={name} /> }));
vi.mock("@/core/components/ui/site-name", () => ({ SiteMark: () => <span data-testid="mark" /> }));

const EN = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));
const wrapper = ({ children }: { children: React.ReactNode }) => (
    <NextIntlClientProvider locale="en" messages={EN}>{children}</NextIntlClientProvider>
);

const { Footer } = await import("@/core/components/layout/Footer");
const { useFooter } = await import("@/core/hooks/useFooter");
const { useLanguageChoice } = await import("@/core/hooks/useLanguageChoice");

beforeEach(() => {
    state.settings = {};
    state.overrides = {};
    state.replace.mockClear();
});

describe("what the footer says, for a theme that draws it", () => {
    it("is the operator's columns, in their words, with the modules' links placed and the way home", () => {
        state.settings = {
            site_name: "Kayadibi",
            footer_about_text: "Open at night too.",
            footer_columns: JSON.stringify([
                { title: "Play", section: "quick", links: [{ label: "Rules", href: "/rules" }] },
                { title: "Empty", section: "legal", links: [] },
            ]),
        };
        const { result } = renderHook(() => useFooter(), { wrapper });
        expect(result.current.siteName).toBe("Kayadibi");
        expect(result.current.about).toBe("Open at night too.");
        expect(result.current.columns.map((c) => c.title)).toEqual(["Play"]);
        expect(result.current.columns[0].links.map((l) => l.label)).toEqual(["Home", "Rules", "Forum"]);
    });

    it("names a column core seeded in the reader's language", () => {
        const { result } = renderHook(() => useFooter(), { wrapper });
        expect(result.current.columns.map((c) => c.title)).toEqual([EN.footer.quickLinks]);
    });

    it("leaves the copyright line to the theme unless the operator wrote one", () => {
        expect(renderHook(() => useFooter(), { wrapper }).result.current.copyright).toBeNull();
        state.settings = { footer_copyright: "All ours." };
        expect(renderHook(() => useFooter(), { wrapper }).result.current.copyright).toBe("All ours.");
    });
});

describe("the language a visitor reads in", () => {
    it("offers every language by its own name and moves the page to the one chosen", () => {
        const { result } = renderHook(() => useLanguageChoice(), { wrapper });
        expect(result.current.locale).toBe("en");
        expect(result.current.options.find((o) => o.value === "tr")?.label).toBe("Türkçe");
        act(() => result.current.choose("tr"));
        expect(state.replace).toHaveBeenCalledWith("/store", { locale: "tr" });
    });
});

describe("the footer a theme draws", () => {
    it("is handed the slot modules draw into, and the bottom slot still follows it", () => {
        state.overrides.Footer = function ThemeFooter({ top }: { top?: React.ReactNode }) {
            return <footer data-testid="theme-footer">{top}</footer>;
        };
        const { container } = render(<Footer />, { wrapper });
        const footer = screen.getByTestId("theme-footer");
        expect(footer.querySelector("[data-slot='footer.top']")).toBeTruthy();
        expect(container.querySelector("footer + [data-slot='layout.bottom']")).toBeTruthy();
    });

    it("is core's own when the theme draws none, with the modules' controls and the credit", () => {
        render(<Footer />, { wrapper });
        expect(screen.getByText("USD")).toBeTruthy();
        expect(screen.getByRole("link", { name: "Forum" })).toBeTruthy();
        expect(document.querySelector("footer [data-slot='footer.top']")).toBeTruthy();
        expect(document.querySelector("footer a[href^='http']")?.textContent).toBeTruthy();
    });
});
