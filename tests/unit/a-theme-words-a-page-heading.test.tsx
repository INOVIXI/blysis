/**
 * A theme can word the band that names a page: a small label over the title,
 * a title of its own and the line under it.
 *
 * The page names itself ("Store") and may say what it is for; a theme with a
 * voice of its own wants "SHOP / Market day / Ranks, cosmetics and coins"
 * there instead, and in every language. So an arrangement may give the
 * heading words, each a message key or words as written, which the band draws
 * over the page's own. The crumb trail still ends on the page's name, which
 * is what the site calls the page everywhere else.
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

const MESSAGES = {
    ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages-core/en.json"), "utf8")),
    sample: { kicker: "Shop", lede: "Ranks, cosmetics and coins." },
};

const { PageFrame } = await import("@/core/components/layout/PageFrame");

function draw(ui: React.ReactNode) {
    return render(<NextIntlClientProvider locale="en" messages={MESSAGES}>{ui}</NextIntlClientProvider>);
}

const WORDED = { kicker: "sample.kicker", title: "Market day", description: "sample.lede" };

beforeEach(() => {
    overrides.current = {};
});

describe("a page heading a theme words", () => {
    it("draws the theme's label, title and line over the page's own", () => {
        draw(<PageFrame title="Store" description="Everything on sale." heading={WORDED}>body</PageFrame>);
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Market day");
        expect(screen.getByText("Shop")).toBeTruthy();
        expect(screen.getByText("Ranks, cosmetics and coins.")).toBeTruthy();
        expect(screen.queryByText("Everything on sale.")).toBeNull();
    });

    it("still ends the crumb trail on the page's own name", () => {
        draw(<PageFrame title="Store" heading={WORDED}>body</PageFrame>);
        expect(document.querySelector("[aria-current=page]")?.textContent).toBe("Store");
    });

    it("keeps the page's own words for whatever the theme left out", () => {
        draw(<PageFrame title="Store" description="Everything on sale." heading={{ kicker: "sample.kicker" }}>body</PageFrame>);
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Store");
        expect(screen.getByText("Everything on sale.")).toBeTruthy();
        expect(screen.getByText("Shop")).toBeTruthy();
    });

    it("is the page's own when the theme gives it no words", () => {
        draw(<PageFrame title="Store" description="Everything on sale.">body</PageFrame>);
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Store");
        expect(screen.getByText("Everything on sale.")).toBeTruthy();
    });

    it("hands a theme's own header the label and the page's name beside the worded title", () => {
        const seen: Record<string, unknown>[] = [];
        overrides.current.PageHeader = function SpyHeader(props) {
            seen.push(props);
            return <header />;
        };
        draw(<PageFrame title="Store" heading={WORDED}>body</PageFrame>);
        expect(seen.at(-1)).toMatchObject({ title: "Market day", pageName: "Store", kicker: "Shop", description: "Ranks, cosmetics and coins." });
    });

    it("keeps the page's name as its unseen h1 when the band is hidden", () => {
        draw(<PageFrame title="Store" heading={WORDED} header="hidden">body</PageFrame>);
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Store");
    });
});
