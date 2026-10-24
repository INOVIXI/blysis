/**
 * Quarry's homepage hero: the server's address one press from the clipboard,
 * and the theme's own words until the operator writes theirs.
 *
 * The copy has to work on a fresh install reached over plain http, where the
 * clipboard API does not exist, and say so when it did not happen rather than
 * claim it did. Every line the operator has not written is the theme's in the
 * reader's language, and the picture and the button take only an address a
 * link may carry, so `javascript:` in a setting reaches nobody.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fs from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({
    config: {} as Record<string, unknown>,
    site: {} as Record<string, unknown>,
    copies: [] as string[],
    copyWorks: true,
}));

vi.mock("@/core/sdk/theme", async () => ({
    useThemeConfig: () => (key: string, fallback?: unknown) => (key in state.config ? state.config[key] : fallback),
    linkTarget: (await import("@/core/lib/setting-link")).linkTarget,
}));
vi.mock("@/core/sdk", () => ({
    copyText: async (value: string) => {
        state.copies.push(value);
        return state.copyWorks;
    },
}));
vi.mock("@/core/sdk/ui", async () => {
    const button = await import("@/core/components/ui/button");
    return { Button: button.Button, buttonClassName: button.buttonClassName, useSiteSettings: () => ({ settings: state.site }) };
});
vi.mock("@/core/sdk/layout", () => ({ Slot: ({ name }: { name: string }) => <div data-testid={`slot:${name}`} /> }));
vi.mock("@/core/sdk/navigation", () => ({
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { default: Hero } = await import("@/themes/quarry/components/Hero");

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/themes/quarry/theme.json"), "utf8"));
const TR = MANIFEST.translations.tr.quarry;

function draw(locale = "tr") {
    return render(
        <NextIntlClientProvider locale={locale} messages={MANIFEST.translations[locale]}>
            <Hero />
        </NextIntlClientProvider>,
    );
}

beforeEach(() => {
    state.config = {};
    state.site = {};
    state.copies = [];
    state.copyWorks = true;
});

describe("the Quarry hero", () => {
    it("greets a fresh Turkish site in Turkish", () => {
        draw();
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(TR.heroTitle);
        expect(screen.getByText(TR.heroTag)).toBeTruthy();
        expect(screen.getByText(TR.heroSubtitle)).toBeTruthy();
    });

    it("says what the operator wrote once they wrote it", () => {
        state.config = { "hero.title": "Sezon dört", "hero.tag": "Yeni", "hero.subtitle": "Gel" };
        draw();
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Sezon dört");
        expect(screen.getByText("Yeni")).toBeTruthy();
        expect(screen.getByText("Gel")).toBeTruthy();
    });

    it("offers no address to copy until there is one", () => {
        draw();
        expect(screen.queryByRole("button", { name: TR.copyAddress })).toBeNull();
    });

    it("copies the address and says it did", async () => {
        state.config = { "hero.address": " oyna.example.net " };
        draw();
        expect(screen.getByText("oyna.example.net")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: TR.copyAddress }));
        await waitFor(() => expect(screen.getByRole("button", { name: TR.addressCopied })).toBeTruthy());
        expect(state.copies).toEqual(["oyna.example.net"]);
    });

    it("says so when the copy did not happen", async () => {
        state.config = { "hero.address": "oyna.example.net" };
        state.copyWorks = false;
        draw();
        fireEvent.click(screen.getByRole("button", { name: TR.copyAddress }));
        await waitFor(() => expect(screen.getByText(TR.copyFailed)).toBeTruthy());
        expect(screen.queryByRole("button", { name: TR.addressCopied })).toBeNull();
    });

    it("draws its own button only once it has somewhere to go", () => {
        state.config = { "hero.ctaText": "Nasıl katılırım?" };
        draw();
        expect(screen.queryByRole("link", { name: "Nasıl katılırım?" })).toBeNull();
        state.config = { "hero.ctaText": "Nasıl katılırım?", "hero.ctaHref": "javascript:alert(1)" };
        draw();
        expect(screen.queryByRole("link", { name: "Nasıl katılırım?" })).toBeNull();
        state.config = { "hero.ctaText": "Nasıl katılırım?", "hero.ctaHref": "/help" };
        draw();
        expect(screen.getByRole("link", { name: "Nasıl katılırım?" }).getAttribute("href")).toBe("/help");
    });

    it("links the site's own Discord address, in the reader's words", () => {
        state.site = { site_discord_url: "https://discord.gg/example" };
        draw("en");
        expect(screen.getByRole("link", { name: MANIFEST.translations.en.quarry.joinDiscord }).getAttribute("href")).toBe("https://discord.gg/example");
    });

    it("stands on the operator's picture only when it is an address a page may load", () => {
        state.config = { "hero.backgroundImage": "javascript:alert(1)" };
        const unsafe = draw();
        expect(unsafe.container.querySelector(".qr-hero-picture")).toBeNull();
        expect(unsafe.container.querySelector(".qr-scene")).not.toBeNull();
        unsafe.unmount();

        state.config = { "hero.backgroundImage": "/uploads/hero.png" };
        const own = draw();
        const picture = own.container.querySelector<HTMLElement>(".qr-hero-picture");
        expect(picture?.style.backgroundImage).toContain("/uploads/hero.png");
        expect(own.container.querySelector(".qr-scene")).toBeNull();
    });

    it("places hero.bottom in the hero", () => {
        draw();
        expect(screen.getByTestId("slot:hero.bottom")).toBeTruthy();
    });

    it("places hero.tags before its own label, where a module says whether the server is open", () => {
        const { container } = draw();
        const tags = container.querySelector(".qr-hero-tags");
        expect(tags?.firstElementChild?.getAttribute("data-testid")).toBe("slot:hero.tags");
        expect(tags?.textContent).toContain(TR.heroTag);
    });

    it("draws the last sentence of a heading of several in the accent colour", () => {
        state.config = { "hero.title": "Yeni harita. Sıfır ekonomi. Boş arsalar." };
        const { container } = draw();
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Yeni harita. Sıfır ekonomi. Boş arsalar.");
        expect(container.querySelector(".qr-hero-accent")?.textContent).toBe("Boş arsalar.");
        state.config = { "hero.title": "Başkası kurmadan sen kur" };
        const single = draw();
        expect(single.container.querySelector(".qr-hero-accent")).toBeNull();
    });

    it("draws nothing once switched off", () => {
        state.config = { "hero.enabled": false };
        const { container } = draw();
        expect(container.innerHTML).toBe("");
    });
});
