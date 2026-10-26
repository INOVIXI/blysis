// @vitest-environment jsdom
/**
 * Kite's footer is the one its approved design drew: the name and the line
 * about the site on the left, the operator's columns beside it, and on the
 * line under them the copyright, the language and a day-or-night switch.
 *
 * It used to be core's footer recoloured, which kept core's arrangement: one
 * column of every link, the language in a "Settings" column of its own and
 * no switch at all. Drawn from the footer's parts it keeps everything core's
 * has, the modules' links and controls, the slot and the credit, in Kite's
 * places.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({
    settings: {} as Record<string, unknown>,
    mode: "light" as "light" | "dark",
    locked: false,
    refreshMode: vi.fn(),
    replace: vi.fn(),
}));

vi.mock("@/core/generated/module-registry", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    ModuleFooterLinks: [{ label: "Forum", labelKey: "forum", href: "/forum", section: "community", module: "forum" }],
    ModuleFooterComponents: [{ id: "currency", module: "store", order: 1 }],
}));
vi.mock("@/core/generated/module-components", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    FooterComponentRegistry: { currency: () => <span>USD</span> },
}));
vi.mock("@/core/providers/module-provider", () => ({ useAllModules: () => ({}) }));
vi.mock("@/core/hooks/useSiteSettings", () => ({ useSiteSettings: () => ({ settings: state.settings }) }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
    useRouter: () => ({ replace: state.replace }),
    usePathname: () => "/forum",
}));
vi.mock("@/core/providers/theme-provider", () => ({
    useTheme: () => ({ activeTheme: { id: "kite" }, currentMode: state.mode, refreshMode: state.refreshMode, locked: state.locked }),
}));
vi.mock("@/core/components/ui/site-name", () => ({ SiteMark: () => <span data-testid="mark" /> }));

const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), rel), "utf8"));
const EN = read("messages-core/en.json");
const KITE = read("src/themes/kite/theme.json").translations.en;
const MESSAGES = { ...EN, kite: KITE.kite };

const { default: Footer } = await import("@/themes/kite/components/Footer");

function draw() {
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <Footer top={<div data-slot="footer.top" />} />
        </NextIntlClientProvider>,
    );
}

beforeEach(() => {
    state.settings = {
        site_name: "Kayadibi",
        footer_about_text: "A Minecraft community under one sky since 2019.",
        footer_columns: JSON.stringify([
            { title: "Game", links: [{ label: "Shop", href: "/store" }] },
            { title: "Community", section: "community", links: [] },
        ]),
    };
    state.mode = "light";
    state.locked = false;
    state.refreshMode.mockClear();
    state.replace.mockClear();
});

describe("Kite's footer", () => {
    it("names the site and says what it is", () => {
        draw();
        expect(screen.getByText("Kayadibi")).toBeTruthy();
        expect(screen.getByText("A Minecraft community under one sky since 2019.")).toBeTruthy();
    });

    it("draws each of the operator's columns under its heading, with what modules add to it", () => {
        draw();
        const community = screen.getByRole("navigation", { name: "Community" });
        expect(within(community).getByRole("heading", { name: "Community" })).toBeTruthy();
        expect(within(community).getByRole("link", { name: "Forum" })).toBeTruthy();
        expect(within(screen.getByRole("navigation", { name: "Game" })).getByRole("link", { name: "Shop" })).toBeTruthy();
    });

    it("says the year and the site's name, or the operator's own line", () => {
        draw();
        expect(screen.getByText(`© ${new Date().getFullYear()} Kayadibi`)).toBeTruthy();
        state.settings.footer_copyright = "All ours.";
        draw();
        expect(screen.getByText("All ours.")).toBeTruthy();
    });

    it("moves the page to the language chosen", () => {
        draw();
        const select = screen.getByLabelText(EN.common.language) as HTMLSelectElement;
        expect(select.value).toBe("en");
        fireEvent.change(select, { target: { value: "tr" } });
        expect(state.replace).toHaveBeenCalledWith("/forum", { locale: "tr" });
    });

    it("switches between day and night, and says which it is", () => {
        draw();
        const day = screen.getByRole("button", { name: KITE.kite.footerDay });
        const night = screen.getByRole("button", { name: KITE.kite.footerNight });
        expect(day.getAttribute("aria-pressed")).toBe("true");
        expect(night.getAttribute("aria-pressed")).toBe("false");
        fireEvent.click(night);
        expect(state.refreshMode).toHaveBeenCalled();
        fireEvent.click(day);
        expect(state.refreshMode).toHaveBeenCalledTimes(1);
    });

    it("offers no switch on a site that holds its mode", () => {
        state.locked = true;
        draw();
        expect(screen.queryByRole("button", { name: KITE.kite.footerNight })).toBeNull();
    });

    it("keeps what modules put in the footer, their slot, and the credit", () => {
        const { container } = draw();
        expect(screen.getByText("USD")).toBeTruthy();
        expect(container.querySelector("footer [data-slot='footer.top']")).toBeTruthy();
        expect(container.querySelector("footer a[href^='http']")).toBeTruthy();
    });
});
