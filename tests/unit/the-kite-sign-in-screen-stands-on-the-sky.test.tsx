/**
 * Kite's sign-in screens sit inside the site's own frame: one card, the
 * page's form on its left and a piece of sky on its right with a line about
 * who is playing and whatever a module has to say beside the form.
 *
 * Sign-in and sign-up each hand their aside to modules under a name of their
 * own and greet the reader in words of their own; the password screens have
 * no aside, since a reset link is not the moment for news. The line on the
 * sky is the operator's, or the theme's own, which counts players through a
 * site placeholder.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({
    path: "/auth/login",
    config: {} as Record<string, unknown>,
}));

vi.mock("@/core/sdk/theme", () => ({
    useThemeConfig: () => (key: string, fallback?: unknown) => (key in state.config ? state.config[key] : fallback),
    PlaceholderText: ({ text }: { text: string }) => <span data-placeholders="">{text}</span>,
}));
vi.mock("@/core/sdk/layout", () => ({
    Navbar: () => <nav data-testid="navbar" />,
    Footer: () => <footer data-testid="footer" />,
    Slot: ({ name }: { name: string }) => <div data-testid={`slot:${name}`} />,
}));
vi.mock("@/core/sdk/navigation", () => ({ usePathname: () => state.path }));

const { default: AuthFrame } = await import("@/themes/kite/components/AuthFrame");

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/themes/kite/theme.json"), "utf8"));
const TR = MANIFEST.translations.tr.kite;

function draw(at: string) {
    state.path = at;
    return render(
        <NextIntlClientProvider locale="tr" messages={MANIFEST.translations.tr}>
            <AuthFrame><form aria-label="the page's form" /></AuthFrame>
        </NextIntlClientProvider>,
    );
}

const asides = () => screen.queryAllByTestId(/^slot:/).map((slot) => slot.getAttribute("data-testid"));

beforeEach(() => {
    state.config = {};
});

describe("the Kite sign-in screens", () => {
    it("keep the site's own bar and footer around the page's form", () => {
        draw("/auth/login");
        expect(screen.getByTestId("navbar")).toBeTruthy();
        expect(screen.getByTestId("footer")).toBeTruthy();
        expect(screen.getByRole("form", { name: "the page's form" }).closest(".kt-auth-form")).not.toBeNull();
    });

    it("greet someone coming back and hand the aside to modules as auth.login.aside", () => {
        draw("/auth/login");
        expect(screen.getByText(TR.authKickerLogin)).toBeTruthy();
        expect(asides()).toEqual(["slot:auth.login.aside"]);
    });

    it("greet someone new and hand the aside to modules as auth.register.aside", () => {
        draw("/auth/register");
        expect(screen.getByText(TR.authKickerRegister)).toBeTruthy();
        expect(asides()).toEqual(["slot:auth.register.aside"]);
    });

    it("offer no aside on the password screens", () => {
        draw("/auth/forgot-password");
        expect(asides()).toEqual([]);
    });

    it("say the theme's line on the sky until the operator writes one", () => {
        const fresh = draw("/auth/login");
        expect(fresh.container.querySelector(".kt-auth-headline [data-placeholders]")?.textContent).toBe(TR.authHeadline);
        fresh.unmount();

        state.config = { "auth.headline": "  Ada seni bekliyor.  " };
        const { container } = draw("/auth/login");
        expect(container.querySelector(".kt-auth-headline")?.textContent).toBe("Ada seni bekliyor.");
    });
});
