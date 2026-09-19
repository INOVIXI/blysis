/**
 * The navbar the server sends is the navbar the browser settles on.
 *
 * The dark mode button is drawn before anyone knows which mode is active:
 * the mode lives in the DOM, put there by an inline script, and a hook reads
 * it after mount. The button held its place through that wait but was also
 * marked `disabled={!mounted}`, which makes one attribute of the served HTML
 * differ from the attribute the same component wants once it has mounted.
 *
 * React reported it as a hydration mismatch on the home page:
 *
 *     + disabled={true}   (client)
 *     - disabled={null}   (server)
 *
 * "This won't be patched up" is the part that matters - React gives up on
 * reconciling that subtree's attributes rather than fixing them. And the
 * attribute was buying nothing: before hydration the button has no click
 * handler attached, so a click already did nothing, and `disabled` only made
 * it unfocusable for the few hundred milliseconds in between.
 *
 * The test renders the button to a string and again after mount, and compares
 * the attributes of the two. The icon is deliberately not compared: it is a
 * child, both sides draw the same placeholder first, and it is the one thing
 * here that is allowed to arrive late.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

vi.mock("next-auth/react", () => ({
    useSession: () => ({ data: null, status: "unauthenticated" }),
    signOut: () => undefined,
}));
vi.mock("@/core/hooks/useSiteSettings", () => ({ useSiteSettings: () => ({ settings: {} }) }));
vi.mock("@/core/providers/module-provider", () => ({ useAllModules: () => ({}) }));
vi.mock("@/core/providers/theme-provider", () => ({ useTheme: () => ({ activeTheme: null }) }));
vi.mock("@/core/generated/module-registry", () => ({
    // `@/core/sdk/ui` reads the activity kinds through this, so a mock
    // that leaves it out breaks on import rather than on an assertion.
    ModuleActivityTitles: [],
    ModuleNavLinks: [], ModuleRoutes: [], ModuleNavbarComponents: [], NavbarComponentRegistry: {},
}));
vi.mock("@/core/generated/theme-components", () => ({ getThemeComponent: () => null }));
vi.mock("@/core/components/Slot", () => ({ Slot: () => null }));
vi.mock("@/core/components/ui/NavIcon", () => ({ NavIcon: () => null }));
vi.mock("@/core/lib/i18n/navigation", () => ({
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
    usePathname: () => "/",
}));

const MESSAGES = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8"));
const { Navbar } = await import("@/core/components/layout/Navbar");

const tree = (
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <Navbar />
    </NextIntlClientProvider>
);

/** The attributes of the mode switch, as the server writes them. */
function servedAttributes(): Record<string, string> {
    const doc = new DOMParser().parseFromString(renderToString(tree), "text/html");
    const button = doc.querySelector('button[aria-label="Switch to dark mode"]') as HTMLElement;
    return Object.fromEntries([...button.attributes].map((a) => [a.name, a.value]));
}

/** The same attributes once the component has mounted and read the mode. */
function settledAttributes(): Record<string, string> {
    const { container } = render(tree);
    // By its own label, not by position: the bar grew a menu button to its
    // left, and "the first labelled button" quietly became a different control.
    const button = container.querySelector('button[aria-label^="Switch to"]') as HTMLElement;
    return Object.fromEntries([...button.attributes].map((a) => [a.name, a.value]));
}

describe("the mode switch the server sends", () => {
    it("carries the attributes the mounted button asks for, so React has nothing to argue with", () => {
        // Not the icon - that is a child, and it is allowed to arrive late
        // because both sides draw the same placeholder first. An attribute is
        // different: React reported `disabled={true}` against `disabled={null}`
        // on the home page and said it would not patch it up.
        expect(servedAttributes()).toEqual(settledAttributes());
    });

    it("is not disabled on its way to knowing the mode", () => {
        // It bought nothing: a button that has not hydrated has no handler.
        expect(servedAttributes()).not.toHaveProperty("disabled");
    });

    it("still holds the icon's place, so the row does not move when it arrives", () => {
        // Why the wait exists at all: rendering nothing until mounted left a
        // gap that filled after paint and pushed the row sideways.
        expect(renderToString(tree)).toMatch(
            /<button[^>]*aria-label="Switch to dark mode"[^>]*><span class="block w-4 h-4"/,
        );
    });
});
