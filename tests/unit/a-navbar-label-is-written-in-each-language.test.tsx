/**
 * A navbar label the operator wrote in several languages is read in the
 * reader's, by the bar the server sends and by the bar the browser settles on.
 *
 * The label had one value, so a Turkish site's "Mağaza" sat in the English
 * bar too. A module's link carries its own translation key, which still wins
 * over the label the editor was seeded with; a translation the operator typed
 * for the reader's language wins over the key, since that is what they chose
 * to show.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("@/core/hooks/useSiteSettings", () => ({ useSiteSettings: () => ({ settings: settings.value, loaded: true }) }));
vi.mock("@/core/providers/module-provider", () => ({ useAllModules: () => ({ store: { enabled: true } }) }));
vi.mock("@/core/generated/module-registry", () => ({
    ModuleNavLinks: [{ module: "store", label: "Store", labelKey: "store", href: "/store" }],
    ModuleRoutes: [],
}));
vi.mock("@/core/lib/i18n/navigation", () => ({ usePathname: () => "/" }));

const { useNavLinks } = await import("@/core/hooks/useNavLinks");

function Labels() {
    const { links } = useNavLinks();
    return <ul>{links.map((link) => <li key={link.href}>{link.label}{link.children?.map((c) => ` ${c.label}`)}</li>)}</ul>;
}

const MESSAGES = {
    en: { nav: { home: "Home", store: "Store" } },
    tr: { nav: { home: "Ana Sayfa", store: "Mağaza" } },
    de: { nav: { home: "Startseite", store: "Shop" } },
} as const;

function labels(locale: keyof typeof MESSAGES, navbar: unknown[]): { served: string; settled: string } {
    settings.value = { navbar_links: navbar };
    const tree = (
        <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
            <Labels />
        </NextIntlClientProvider>
    );
    const served = new DOMParser().parseFromString(renderToString(tree), "text/html").body.textContent ?? "";
    const { container, unmount } = render(tree);
    const settled = container.textContent ?? "";
    unmount();
    return { served, settled };
}

describe("a navbar label", () => {
    const navbar = [
        { label: { default: "Kurallar", en: "Rules" }, href: "/rules" },
        { label: { default: "Store", tr: "Dükkan" }, labelKey: "store", href: "/store" },
        { label: { default: "Daha fazla", en: "More" }, href: "#", children: [{ label: { default: "Destek", en: "Support" }, href: "/help" }] },
    ];

    it("is the reader's translation", () => {
        expect(labels("en", navbar).settled).toBe("RulesStoreMore Support");
    });

    it("is the original text where the reader's language has none", () => {
        expect(labels("tr", navbar).settled).toBe("KurallarDükkanDaha fazla Destek");
    });

    it("defers to a module's own translation where the operator wrote none for the reader", () => {
        expect(labels("de", navbar).settled).toContain("Shop");
    });

    it("is a plain string in every language, as it was", () => {
        expect(labels("de", [{ label: "Kurallar", href: "/rules" }]).settled).toBe("Kurallar");
    });

    it("is the same word in the served bar and the settled one", () => {
        for (const locale of ["en", "tr", "de"] as const) {
            const { served, settled } = labels(locale, navbar);
            expect(served, locale).toBe(settled);
        }
    });
});
