/**
 * Quarry's sign-in screens are laid out like a game's launcher: the site's
 * menu in a rail, a picture with the server's state and something to read
 * on it, and the form beside them with the address one press away.
 *
 * Sign-in and sign-up each show the operator's own picture, or the drawn
 * landscape until there is one, and each hands its aside to modules under a
 * name of its own: someone coming back is shown what changed, someone new
 * where they will play. The other account screens wear the sign-in picture
 * and no aside, since a reset link is not the moment for news.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({
    path: "/auth/login",
    config: {} as Record<string, unknown>,
    copies: [] as string[],
}));

vi.mock("@/core/sdk/theme", async () => ({
    useThemeConfig: () => (key: string, fallback?: unknown) => (key in state.config ? state.config[key] : fallback),
    linkTarget: (await import("@/core/lib/setting-link")).linkTarget,
    useNavLinks: () => ({ links: [{ label: "Mağaza", href: "/store", icon: "ShoppingBag" }, { label: "Forum", href: "/forum", icon: "MessageSquare" }], arranged: false, isActive: () => false }),
    SiteMark: () => <span data-testid="mark" />,
    SiteName: () => <span>Kayadibi</span>,
}));
vi.mock("@/core/sdk", () => ({
    copyText: async (value: string) => {
        state.copies.push(value);
        return true;
    },
}));
vi.mock("@/core/sdk/ui", async () => {
    const button = await import("@/core/components/ui/button");
    return { Button: button.Button, NavIcon: ({ name }: { name?: string }) => <i data-icon={name} /> };
});
vi.mock("@/core/sdk/layout", () => ({ Slot: ({ name }: { name: string }) => <div data-testid={`slot:${name}`} /> }));
vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
    usePathname: () => state.path,
}));

const { default: AuthFrame } = await import("@/themes/quarry/components/AuthFrame");

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/themes/quarry/theme.json"), "utf8"));
const CORE = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/tr.json"), "utf8"));
const TR = MANIFEST.translations.tr.quarry;

function draw(at: string) {
    state.path = at;
    return render(
        <NextIntlClientProvider locale="tr" messages={{ ...CORE, ...MANIFEST.translations.tr }}>
            <AuthFrame><form aria-label="the page's form" /></AuthFrame>
        </NextIntlClientProvider>,
    );
}

const picture = (container: HTMLElement) => container.querySelector<HTMLElement>(".qr-auth-picture")?.style.backgroundImage ?? null;

beforeEach(() => {
    state.config = {};
    state.copies = [];
});

describe("the Quarry sign-in screens", () => {
    it("are declared as a settings group with a picture for each form", () => {
        expect(Object.keys(MANIFEST.settings.auth.fields)).toEqual(["loginImage", "registerImage"]);
    });

    it("put the site's menu in a rail beside the page's own form", () => {
        draw("/auth/login");
        const rail = screen.getByRole("navigation", { name: CORE.nav.primary });
        expect(within(rail).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/", "/store", "/forum"]);
        expect(screen.getByRole("form", { name: "the page's form" })).toBeTruthy();
    });

    it("show the sign-in picture, the server's state and the news slot on sign-in", () => {
        state.config = { "auth.loginImage": "/uploads/in.jpg", "auth.registerImage": "/uploads/up.jpg" };
        const { container } = draw("/auth/login");
        expect(picture(container)).toContain("/uploads/in.jpg");
        expect(screen.getByTestId("slot:hero.tags")).toBeTruthy();
        expect(screen.getByText(TR.heroTag)).toBeTruthy();
        expect(screen.getByTestId("slot:auth.login.aside")).toBeTruthy();
        expect(screen.queryByTestId("slot:auth.register.aside")).toBeNull();
        expect(screen.getByText(TR.authKickerLogin)).toBeTruthy();
    });

    it("show the sign-up picture and the sign-up slot on sign-up", () => {
        state.config = { "auth.loginImage": "/uploads/in.jpg", "auth.registerImage": "/uploads/up.jpg" };
        const { container } = draw("/auth/register");
        expect(picture(container)).toContain("/uploads/up.jpg");
        expect(screen.getByTestId("slot:auth.register.aside")).toBeTruthy();
        expect(screen.queryByTestId("slot:auth.login.aside")).toBeNull();
        expect(screen.getByText(TR.authKickerRegister)).toBeTruthy();
    });

    it("wear the sign-in picture and no aside on the other account screens", () => {
        state.config = { "auth.loginImage": "/uploads/in.jpg" };
        const { container } = draw("/auth/forgot-password");
        expect(picture(container)).toContain("/uploads/in.jpg");
        expect(screen.queryByTestId("slot:auth.login.aside")).toBeNull();
        expect(screen.queryByTestId("slot:auth.register.aside")).toBeNull();
    });

    it("draw the landscape until there is a picture, and refuse one a link may not carry", () => {
        const { container, unmount } = draw("/auth/login");
        expect(picture(container)).toBeNull();
        expect(container.querySelector(".qr-auth-scene .qr-scene")).toBeTruthy();
        unmount();
        state.config = { "auth.loginImage": "javascript:alert(1)" };
        expect(picture(draw("/auth/login").container)).toBeNull();
    });

    it("hand over the server's address in one press, once there is one", async () => {
        expect(draw("/auth/login").queryByRole("button", { name: TR.copyAddress })).toBeNull();
        state.config = { "hero.address": "oyna.kayadibi.net" };
        draw("/auth/register");
        expect(screen.getByText("oyna.kayadibi.net")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: TR.copyAddress }));
        await waitFor(() => expect(state.copies).toEqual(["oyna.kayadibi.net"]));
        expect(await screen.findByText(TR.addressCopied)).toBeTruthy();
    });
});
