/**
 * Every place a theme or the site draws text the operator wrote reads it in
 * the reader's language, the same on the server as in the browser.
 *
 * A theme's hero heading, a block's line that points at it, the site's name
 * and the footer's words each had one value. They may now carry a translation
 * per language (`translatable-text.ts`), and each of these readers used to
 * test for a string and draw nothing, or "[object Object]", when handed one.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("@/core/hooks/useSiteSettings", () => ({ useSiteSettings: () => ({ settings: settings.value, loaded: true }) }));
vi.mock("@/core/hooks/usePlaceholder", () => ({
    usePlaceholderFill: () => (text: string) => text.replace("{servers.online}", "42"),
}));
vi.mock("@/core/providers/module-provider", () => ({ useAllModules: () => ({}) }));
vi.mock("@/core/generated/module-registry", () => ({ ModuleFooterLinks: [] }));

const { ThemeConfigProvider, useThemeConfig } = await import("@/core/lib/theme-config-client");
const { useBlockText } = await import("@/core/hooks/useBlockText");
const { SiteName } = await import("@/core/components/ui/site-name");
const { useFooter } = await import("@/core/hooks/useFooter");

const MESSAGES = { common: { appName: "Blysis", home: "Home" }, footer: {}, nav: {} };

function Words() {
    const get = useThemeConfig();
    const text = useBlockText();
    const footer = useFooter();
    return (
        <p>
            {get<string>("hero.title")}|{text({ default: "Satır", en: "Line" })}|<SiteName />|{footer.siteName}|{footer.about}|{footer.copyright}
        </p>
    );
}

function draw(locale: string): { served: string; settled: string } {
    const tree = (
        <NextIntlClientProvider locale={locale} messages={MESSAGES}>
            <ThemeConfigProvider
                value={{ hero: { title: { default: "{servers.online} oyuncu", en: "{servers.online} players" } } }}
                placeholderFields={new Set(["hero.title"])}
            >
                <Words />
            </ThemeConfigProvider>
        </NextIntlClientProvider>
    );
    const served = new DOMParser().parseFromString(renderToString(tree), "text/html").body.textContent ?? "";
    const { container, unmount } = render(tree);
    const settled = container.textContent ?? "";
    unmount();
    return { served, settled };
}

describe("text the operator wrote per language", () => {
    settings.value = {
        site_name: { default: "Vanilya Sunucusu", en: "Vanilla Server" },
        footer_about_text: { default: "Hakkımızda", en: "About us" },
        footer_copyright: { default: "Tüm hakları saklıdır", de: "Alle Rechte vorbehalten" },
    };

    it("is read in the reader's language, with its placeholders filled", () => {
        expect(draw("en").settled).toBe("42 players|Line|Vanilla Server|Vanilla Server|About us|Tüm hakları saklıdır");
    });

    it("is the original wherever the reader's language has nothing", () => {
        expect(draw("fr").settled).toBe("42 oyuncu|Satır|Vanilya Sunucusu|Vanilya Sunucusu|Hakkımızda|Tüm hakları saklıdır");
    });

    it("is the same on the server as in the browser", () => {
        for (const locale of ["en", "de", "tr"]) {
            const { served, settled } = draw(locale);
            expect(served, locale).toBe(settled);
        }
    });
});
