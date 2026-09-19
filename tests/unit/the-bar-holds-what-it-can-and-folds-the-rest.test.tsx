/**
 * The navigation bar folds what it cannot fit, instead of wrapping.
 *
 * The bar draws one link per enabled module, and modules are the point of the
 * product: an install with fifteen of them had fifteen links plus Home, which
 * at 1440px wrapped onto a second row and pushed the header's height around.
 * Nothing was hidden and nothing was reachable either - it just looked
 * broken, and it got worse with every module installed.
 *
 * So the bar keeps the first few and folds the rest into one dropdown. The
 * fold is by count rather than by measurement: a number is the same on the
 * server as in the browser, and anything measured is known only after paint,
 * which is a layout shift in the header on every single page.
 *
 * A bar an admin arranged in the navbar editor is drawn as arranged. They put
 * the dropdowns where they wanted them.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const links = Array.from({ length: 15 }, (_, i) => ({
    label: `Module ${i + 1}`,
    href: `/m${i + 1}`,
    icon: "Package",
    position: (i + 1) * 10,
    module: `m${i + 1}`,
}));

let settings: Record<string, unknown> = {};

vi.mock("next-auth/react", () => ({
    useSession: () => ({ data: null, status: "unauthenticated" }),
    signOut: () => undefined,
}));
vi.mock("@/core/hooks/useSiteSettings", () => ({ useSiteSettings: () => ({ settings }) }));
vi.mock("@/core/providers/module-provider", () => ({ useAllModules: () => ({}) }));
vi.mock("@/core/providers/theme-provider", () => ({ useTheme: () => ({ activeTheme: null }) }));
vi.mock("@/core/generated/module-registry", () => ({
    // `@/core/sdk/ui` reads the activity kinds through this, so a mock
    // that leaves it out breaks on import rather than on an assertion.
    ModuleActivityTitles: [],
    ModuleNavLinks: links, ModuleRoutes: [], ModuleNavbarComponents: [], NavbarComponentRegistry: {},
}));
vi.mock("@/core/generated/theme-components", () => ({ getThemeComponent: () => null }));
vi.mock("@/core/components/Slot", () => ({ Slot: () => null }));
vi.mock("@/core/components/ui/NavIcon", () => ({ NavIcon: () => null }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
    usePathname: () => "/",
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));
const { Navbar, INLINE_NAV_LINKS } = await import("@/core/components/layout/Navbar");

function draw() {
    settings = {};
    return render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
            <Navbar />
        </NextIntlClientProvider>,
    );
}

/** The desktop bar. The mobile one is its own component. */
const bar = () => screen.getByRole("navigation", { name: "Primary" });

describe("a bar with more links than it can hold", () => {
    it("draws the first few and no more", () => {
        draw();
        const drawn = within(bar()).getAllByRole("link");
        expect(drawn).toHaveLength(INLINE_NAV_LINKS);
    });

    it("folds the rest into one dropdown, named as more", () => {
        draw();
        const triggers = within(bar()).getAllByRole("button", { expanded: false });
        expect(triggers).toHaveLength(1);
        expect(triggers[0].textContent).toContain("More");
    });

    it("still leads to every link, once the fold is opened", () => {
        draw();
        fireEvent.click(within(bar()).getByRole("button", { expanded: false }));

        const reachable = within(bar()).getAllByRole("link").map((a) => a.getAttribute("href"));
        for (const link of links) expect(reachable, link.href).toContain(link.href);
        expect(reachable).toContain("/");
    });

    it("opens from the keyboard, because a bar nobody can tab into is not navigation", () => {
        // It used to open on hover alone: the trigger took focus and did
        // nothing, so every folded link was unreachable without a mouse.
        draw();
        const trigger = within(bar()).getByRole("button", { expanded: false });
        trigger.focus();
        fireEvent.keyDown(trigger, { key: "Enter" });
        expect(trigger.getAttribute("aria-expanded")).toBe("true");

        fireEvent.keyDown(trigger, { key: "Escape" });
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });
});

describe("a bar an admin arranged", () => {
    it("is drawn as arranged, however long it is", () => {
        const arranged = links.map((l) => ({ label: l.label, href: l.href, icon: l.icon }));
        settings = { navbar_links: arranged };
        render(
            <NextIntlClientProvider locale="en" messages={MESSAGES}>
                <Navbar />
            </NextIntlClientProvider>,
        );
        expect(within(bar()).getAllByRole("link")).toHaveLength(arranged.length);
        expect(within(bar()).queryAllByRole("button", { expanded: false })).toHaveLength(0);
    });
});
