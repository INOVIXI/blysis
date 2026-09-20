// @vitest-environment node
/**
 * A module's settings screen is somewhere an operator can find it.
 *
 * A module says where its own settings live in one of two ways and the panel
 * only drew one of them. A `menu` entry becomes a sidebar link; a
 * `settingsCards` entry became nothing at all - it reached the command
 * palette and no further. Measured on 2026-09-20: 62 modules ship a settings
 * card, 37 of those have no menu entry pointing at the same screen, and every
 * one of those 37 screens - every OAuth provider, the chat widgets, the
 * external database connection - was reachable only by typing its address or
 * guessing at the palette.
 *
 * So the cards are a contributor to the navigation like everything else, in
 * the Settings group where they belong, and a card whose screen a menu entry
 * already names is not listed twice.
 *
 * The name comes from the module's own translations, because a manifest
 * literal is one language: a Turkish operator was offered "Sign in with
 * Apple" and "External data" in a panel that is otherwise entirely theirs.
 */
import { describe, it, expect } from "vitest";
import { buildNavGroups } from "@/core/lib/admin-nav-groups";

const CARDS = [
    { module: "apple-auth", title: "Sign in with Apple", href: "/settings/apple-auth", icon: "Apple" },
    { module: "stripe-gateway", title: "Stripe", href: "/settings/stripe", icon: "CreditCard" },
];

/** A module that already lists the same screen in its menu. */
const STRIPE_WITH_A_MENU = {
    id: "stripe-gateway",
    menu: [{ path: "/settings/stripe", label: "Stripe Settings", group: "commerce" }],
};

function settingsItems(groups: ReturnType<typeof buildNavGroups>): string[] {
    const settings = groups.find((group) => group.id === "settings");
    return (settings?.sections ?? []).flatMap((section) => section.items.map((item) => item.href));
}

describe("a module that ships a settings card", () => {
    it("gets a link in the panel's settings group", () => {
        const groups = buildNavGroups({ settingsCards: CARDS });

        expect(settingsItems(groups)).toContain("/admin/settings/apple-auth");
    });

    it("does not get a second link when its menu already names the screen", () => {
        const groups = buildNavGroups({ modules: [STRIPE_WITH_A_MENU], settingsCards: CARDS });
        const everywhere = groups.flatMap((g) => g.sections.flatMap((s) => s.items.map((i) => i.href)));

        expect(everywhere.filter((href) => href === "/admin/settings/stripe")).toHaveLength(1);
    });

    it("is named in the reader's language, not the manifest's", () => {
        const groups = buildNavGroups({
            settingsCards: CARDS,
            translate: (key, fallback) => (key === "settings_apple-auth" ? "Apple ile Giriş" : fallback),
        });
        const settings = groups.find((group) => group.id === "settings");
        const item = settings?.sections.flatMap((s) => s.items).find((i) => i.href === "/admin/settings/apple-auth");

        expect(item?.label).toBe("Apple ile Giriş");
    });

    it("falls back to what the manifest says when nothing is translated", () => {
        const groups = buildNavGroups({ settingsCards: CARDS });
        const settings = groups.find((group) => group.id === "settings");
        const item = settings?.sections.flatMap((s) => s.items).find((i) => i.href === "/admin/settings/apple-auth");

        expect(item?.label).toBe("Sign in with Apple");
    });
});

describe("a panel with no such module installed", () => {
    it("keeps the settings group it always had", () => {
        const groups = buildNavGroups();
        expect(settingsItems(groups)).toContain("/admin/settings/general");
    });
});
