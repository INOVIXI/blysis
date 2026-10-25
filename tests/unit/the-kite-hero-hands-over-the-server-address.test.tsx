/**
 * Kite's homepage hero: the server's address one press from the clipboard,
 * the theme's own words until the operator writes theirs, and under it the
 * three steps from a closed game to standing on the server.
 *
 * The copy has to work on a fresh install reached over plain http, where the
 * clipboard API does not exist, and say so when it did not happen rather than
 * claim it did. The line under the heading counts who is playing through a
 * site placeholder, so it is handed to `PlaceholderText` as written, and the
 * third step names the address once there is one.
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
    PlaceholderText: ({ text }: { text: string }) => <span data-placeholders="">{text}</span>,
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

const { default: Hero } = await import("@/themes/kite/components/Hero");

const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/themes/kite/theme.json"), "utf8"));
const TR = MANIFEST.translations.tr.kite;

function draw(locale = "tr") {
    return render(
        <NextIntlClientProvider locale={locale} messages={MANIFEST.translations[locale]}>
            <Hero />
        </NextIntlClientProvider>,
    );
}

const steps = () => [...document.querySelectorAll(".kt-step")].map((li) => li.lastElementChild?.textContent);

beforeEach(() => {
    state.config = {};
    state.site = {};
    state.copies = [];
    state.copyWorks = true;
});

describe("the Kite hero", () => {
    it("greets a fresh Turkish site in Turkish, counting who plays through a placeholder", () => {
        const { container } = draw();
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(TR.heroTitle);
        expect(screen.getByText(TR.heroTag)).toBeTruthy();
        expect(container.querySelector(".kt-hero-lede [data-placeholders]")?.textContent).toBe(TR.heroSubtitle);
    });

    it("says what the operator wrote once they wrote it", () => {
        state.config = { "hero.title": "Sezon dört", "hero.tag": "Yeni", "hero.subtitle": "Gel" };
        draw();
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Sezon dört");
        expect(screen.getByText("Yeni")).toBeTruthy();
        expect(screen.getByText("Gel")).toBeTruthy();
    });

    it("breaks the heading after its first comma and underlines the word that opens the second line", () => {
        state.config = { "hero.title": "Adanı kur, rüzgârı yakala, uç." };
        const { container } = draw();
        const heading = screen.getByRole("heading", { level: 2 });
        expect(heading.textContent).toBe("Adanı kur, rüzgârı yakala, uç.");
        expect(heading.querySelector("br")).not.toBeNull();
        expect(container.querySelector(".kt-hero-stroke")?.textContent).toBe("rüzgârı");

        state.config = { "hero.title": "Başkası kurmadan sen kur" };
        const single = draw();
        expect(single.container.querySelector(".kt-hero-stroke")).toBeNull();
        expect(single.container.querySelector("h2 br")).toBeNull();
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

    it("draws its own button only once it has somewhere a link may go", () => {
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
        expect(screen.getByRole("link", { name: MANIFEST.translations.en.kite.joinDiscord }).getAttribute("href")).toBe("https://discord.gg/example");
    });

    it("places hero.tags before its own label, where a module says whether the server is open", () => {
        const { container } = draw();
        const tags = container.querySelector(".kt-hero-tags");
        expect(tags?.firstElementChild?.getAttribute("data-testid")).toBe("slot:hero.tags");
        expect(tags?.textContent).toContain(TR.heroTag);
    });

    it("walks a newcomer through three steps, the last naming the address once there is one", () => {
        draw();
        expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(TR.stepsTitle);
        expect(steps()).toEqual([
            TR.step1Title + TR.step1Text,
            TR.step2Title + TR.step2Text,
            TR.step3Title + TR.step3TextPlain,
        ]);

        state.config = { "hero.address": "oyna.example.net" };
        draw();
        expect(steps().at(-1)).toBe(TR.step3Title + TR.step3Text.replace("{address}", "oyna.example.net"));
    });

    it("says the operator's own steps, and none once they are switched off", () => {
        state.config = { "steps.step1Title": "İndir", "steps.step3Text": "play.example.net" };
        const written = draw();
        expect(steps()[0]).toBe("İndir" + TR.step1Text);
        expect(steps()[2]).toBe(TR.step3Title + "play.example.net");
        written.unmount();

        state.config = { "steps.enabled": false };
        const { container } = draw();
        expect(container.querySelector(".kt-steps")).toBeNull();
        expect(screen.getByRole("heading", { level: 2 })).toBeTruthy();
    });

    it("draws nothing once switched off", () => {
        state.config = { "hero.enabled": false };
        const { container } = draw();
        expect(container.innerHTML).toBe("");
    });
});
