/**
 * A visitor reading prices in the site's own currency reads them as entered.
 *
 * The visitor's currency choice is stored with the rate it had when they made
 * it. A site that charged in dollars stored a lira choice as `{ TRY, 50 }`;
 * when the operator then switched the site to charge in lira, that visitor
 * read every price fifty times too high, because the stored rate was still
 * applied to amounts now entered in lira. The footer picker re-quotes a stored
 * choice only when it differs from the base, so nothing ever corrected it.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const settings = { default_currency: "TRY" };
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/core/hooks/useSiteSettings", () => ({
    useSiteSettings: () => ({ settings, loaded: true }),
}));

const { SiteCurrencyProvider, useSiteCurrency } = await import("@/core/components/currency/site-currency");

const STORAGE_KEY = "blysis_display_currency";

function Price() {
    const { code, format } = useSiteCurrency();
    return <p data-testid="price" data-code={code}>{format(200)}</p>;
}

describe("a stored choice of the site's own currency", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("shows the price as entered, whatever rate was stored with it", async () => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: "TRY", rate: 50.21 }));
        render(<SiteCurrencyProvider><Price /></SiteCurrencyProvider>);
        const price = await screen.findByTestId("price");
        expect(price.getAttribute("data-code")).toBe("TRY");
        expect(price.textContent).toContain("200.00");
        expect(price.textContent).not.toContain("10,042");
    });

    it("still converts a choice of another currency", async () => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: "USD", rate: 0.02 }));
        render(<SiteCurrencyProvider><Price /></SiteCurrencyProvider>);
        const price = await screen.findByTestId("price");
        expect(price.getAttribute("data-code")).toBe("USD");
        expect(price.textContent).toContain("4.00");
    });
});
