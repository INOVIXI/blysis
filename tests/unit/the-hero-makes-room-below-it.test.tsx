/**
 * The default theme's hero makes room for what modules put below it.
 *
 * `hero.bottom` is the place a module draws beneath the banner - the staff
 * module's strip of who is online is declared there - and no theme rendered
 * the slot, so the contribution was installed, enabled and never seen. The
 * hero also linked its button with `next/link`, which drops the visitor's
 * locale: a Turkish reader pressing it landed on the English site.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const config = vi.hoisted(() => ({ values: {} as Record<string, unknown>, pathname: "/" }));

vi.mock("@/core/sdk/theme", () => ({
    useThemeConfig: () => (key: string, fallback?: unknown) => (key in config.values ? config.values[key] : fallback),
}));
vi.mock("@/core/sdk/layout", () => ({
    Slot: ({ name }: { name: string }) => <div data-testid={`slot:${name}`} />,
}));
vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
        <a data-locale-aware href={href} {...rest}>{children}</a>
    ),
    usePathname: () => config.pathname,
}));

const { default: Hero } = await import("@/themes/flat/components/Hero");

describe("the default theme's hero", () => {
    it("places hero.bottom under the banner", () => {
        config.values = { "hero.enabled": true, "hero.title": "Welcome" };
        render(<Hero />);
        expect(screen.getByTestId("slot:hero.bottom")).toBeTruthy();
    });

    it("keeps the visitor's language when its button is pressed", () => {
        config.values = { "hero.enabled": true, "hero.title": "Welcome", "hero.ctaText": "Join", "hero.ctaHref": "/store" };
        render(<Hero />);
        expect(screen.getByRole("link", { name: /Join/ }).hasAttribute("data-locale-aware")).toBe(true);
    });

    it("is the homepage's, as its setting says, not every page's", () => {
        // Drawn on every page, it stood above each page's own title.
        config.values = { "hero.enabled": true, "hero.title": "Welcome" };
        config.pathname = "/store";
        const { container } = render(<Hero />);
        config.pathname = "/";
        expect(container.innerHTML).toBe("");
    });

    it("leaves the page's one h1 to the page", () => {
        config.values = { "hero.enabled": true, "hero.title": "Welcome" };
        render(<Hero />);
        expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
        expect(screen.getByRole("heading", { name: "Welcome" })).toBeTruthy();
    });

    it("draws nothing at all while it is switched off", () => {
        config.values = { "hero.enabled": false };
        const { container } = render(<Hero />);
        expect(container.innerHTML).toBe("");
    });
});
