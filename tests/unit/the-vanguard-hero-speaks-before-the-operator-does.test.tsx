/**
 * Vanguard's homepage hero, before and after an operator writes their own.
 *
 * Its settings are free text and start empty. A default typed in English
 * into the manifest would greet a Turkish site in English until somebody
 * thought to open the theme's settings, so every line falls back to the
 * theme's own string in the reader's language instead. The button's address
 * is free text too and goes through `linkTarget`, which
 * a-link-from-a-setting-goes-only-where-a-link-may tests.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({ config: {} as Record<string, unknown>, site: {} as Record<string, unknown>, slotted: true }));

vi.mock("@/core/sdk/theme", async () => ({
    useThemeConfig: () => (key: string, fallback?: unknown) => (key in state.config ? state.config[key] : fallback),
    linkTarget: (await import("@/core/lib/setting-link")).linkTarget,
}));
vi.mock("@/core/sdk/ui", () => ({ useSiteSettings: () => ({ settings: state.site }) }));
vi.mock("@/core/sdk/layout", () => ({
    Slot: ({ name }: { name: string }) => <div data-testid={`slot:${name}`} />,
    useSlotHasContent: () => state.slotted,
}));
vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { default: Hero } = await import("@/themes/vanguard/components/Hero");

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/themes/vanguard/theme.json"), "utf8"));

function draw(locale: string) {
    return render(
        <NextIntlClientProvider locale={locale} messages={MANIFEST.translations[locale]}>
            <Hero />
        </NextIntlClientProvider>,
    );
}

beforeEach(() => {
    state.config = {};
    state.site = {};
    state.slotted = true;
});

describe("the Vanguard hero", () => {
    it("greets a fresh Turkish site in Turkish", () => {
        draw("tr");
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(MANIFEST.translations.tr.vanguard.heroTitle);
        expect(screen.getByText(MANIFEST.translations.tr.vanguard.heroTag)).toBeTruthy();
    });

    it("says what the operator wrote once they wrote it", () => {
        state.config = { "hero.title": "Sezon dört", "hero.tag": "Yeni" };
        draw("tr");
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Sezon dört");
        expect(screen.getByText("Yeni")).toBeTruthy();
    });

    it("draws its button only once it has somewhere to go", () => {
        state.config = { "hero.ctaText": "Nasıl katılırım?" };
        draw("tr");
        expect(screen.queryByRole("link", { name: "Nasıl katılırım?" })).toBeNull();
        state.config = { "hero.ctaText": "Nasıl katılırım?", "hero.ctaHref": "/help" };
        draw("tr");
        expect(screen.getByRole("link", { name: "Nasıl katılırım?" }).getAttribute("href")).toBe("/help");
    });

    it("links the site's own Discord address, in the reader's words", () => {
        state.site = { site_discord_url: "https://discord.gg/example" };
        draw("en");
        expect(screen.getByRole("link", { name: MANIFEST.translations.en.vanguard.joinDiscord }).getAttribute("href")).toBe("https://discord.gg/example");
    });

    it("places hero.bottom on the stage", () => {
        draw("en");
        expect(screen.getByTestId("slot:hero.bottom")).toBeTruthy();
    });

    it("keeps the line under it only for a module that draws there", () => {
        // What a module draws there arrives after the page, and the hero grew
        // by it: everything under the hero moved 69px on a load
        // (a-page-settles-and-asks-once). The line's room is held from the
        // first paint when a module will draw in it, and not at all when none
        // will.
        const { container } = draw("en");
        expect(container.querySelector(".vg-hero-bottom")).not.toBeNull();
        state.slotted = false;
        const bare = draw("en").container;
        expect(bare.querySelector(".vg-hero-bottom")).toBeNull();
    });

    it("draws nothing once switched off", () => {
        state.config = { "hero.enabled": false };
        const { container } = draw("en");
        expect(container.innerHTML).toBe("");
    });
});
