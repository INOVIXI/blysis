/**
 * A theme can redraw the frame every page is drawn in, not only its hero.
 *
 * A theme could replace the hero, the navbar and the footer, and nothing
 * between them: the column the page sits in, the band that names the page and
 * the screen around the sign-in form were core's, on every theme. A look that
 * puts the navigation down the left edge or the page title on a backdrop had
 * nowhere to start from. These are the places it starts from, and each one
 * still falls back to core's own drawing when the theme brings none.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const overrides = vi.hoisted(() => ({ current: {} as Record<string, React.ComponentType<Record<string, unknown>>> }));

vi.mock("@/core/generated/theme-components", () => ({
    getThemeComponent: (_themeId: string, name: string) => overrides.current[name] ?? null,
}));
vi.mock("@/core/providers/theme-provider", () => ({
    useTheme: () => ({ activeTheme: { id: "test-theme" } }),
}));
vi.mock("@/core/components/layout", () => ({
    Navbar: () => <nav data-testid="navbar" />,
    Footer: () => <footer data-testid="footer" />,
}));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
        <a href={href} {...rest}>{children}</a>
    ),
}));
vi.mock("@/core/components/ui/site-name", () => ({
    SiteName: () => <span>Site</span>,
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));

const { PageFrame } = await import("@/core/components/layout/PageFrame");
const { AuthFrame } = await import("@/core/components/layout/AuthFrame");

function draw(ui: React.ReactNode) {
    return render(<NextIntlClientProvider locale="en" messages={MESSAGES}>{ui}</NextIntlClientProvider>);
}

type Props = Record<string, unknown>;

function ThemeShell({ children }: Props) {
    return <div data-testid="theme-shell">{children as React.ReactNode}</div>;
}

function ThemeHeader(props: Props) {
    return (
        <header data-testid="theme-header">
            {String(props.title)}|{props.description as React.ReactNode}|
            {(props.trail as { label: string }[]).map((c) => c.label).join(">")}|{props.actions as React.ReactNode}
        </header>
    );
}

function ThemeAuth({ children }: Props) {
    return <div data-testid="theme-auth">{children as React.ReactNode}</div>;
}

beforeEach(() => {
    overrides.current = {};
});

describe("a theme's frame", () => {
    it("draws the page inside the theme's shell", () => {
        overrides.current.SiteShell = ThemeShell;
        draw(<PageFrame title="Trophies">body</PageFrame>);
        const shell = screen.getByTestId("theme-shell");
        expect(shell.textContent).toContain("body");
        expect(shell.querySelector("h1")?.textContent).toBe("Trophies");
        expect(screen.queryByTestId("navbar")).toBeNull();
    });

    it("hands the page's name, description, trail and actions to the theme's header", () => {
        overrides.current.PageHeader = ThemeHeader;
        draw(
            <PageFrame title="New ticket" description="Ask us" trail={[{ label: "Support", href: "/support" }]} actions={<button>Go</button>}>
                body
            </PageFrame>,
        );
        expect(screen.getByTestId("theme-header").textContent).toBe("New ticket|Ask us|Support|Go");
    });

    it("draws a sign-in screen inside the theme's frame", () => {
        overrides.current.AuthFrame = ThemeAuth;
        draw(<AuthFrame><form aria-label="sign in" /></AuthFrame>);
        expect(screen.getByTestId("theme-auth").querySelector("form")).not.toBeNull();
    });
});

describe("with no theme frame", () => {
    it("draws core's own shell and header", () => {
        draw(<PageFrame title="Trophies">body</PageFrame>);
        expect(screen.getByTestId("navbar")).toBeTruthy();
        expect(screen.getByTestId("footer")).toBeTruthy();
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Trophies");
        expect(document.querySelector("main")?.textContent).toContain("body");
    });

    it("draws core's own sign-in screen, with the way home", () => {
        draw(<AuthFrame><form aria-label="sign in" /></AuthFrame>);
        expect(screen.getByRole("link", { name: MESSAGES.auth.backToHome }).getAttribute("href")).toBe("/");
        expect(screen.getByRole("form", { name: "sign in" })).toBeTruthy();
    });
});
