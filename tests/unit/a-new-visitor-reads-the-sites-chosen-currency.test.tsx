/**
 * A visitor who never picked a currency reads prices in the one the site
 * chose for them, and a visitor who did pick one keeps theirs.
 *
 * Prices are entered in the site's base currency. A site that charges in
 * dollars but is read mostly in Turkish wants a new visitor to see lira, and
 * there was no way to say so: with nothing in storage the provider showed the
 * base, and the only way to show anything else was `setDisplay`, which saves
 * the value as if the visitor had chosen it. A default saved that way never
 * changes again for that visitor, whatever the operator later picks.
 *
 * So the default is its own call, `setDefaultDisplay`, held for the page and
 * never stored. The visitor's own choice wins over it; `setDisplay(null)`
 * clears that choice and the default shows again.
 *
 * Both are applied after mount. The server knows neither the visitor's
 * storage nor the module's setting, so the server and the first browser
 * render both draw the base, and React hydrates against the same text.
 */
import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { act, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/core/hooks/useSiteSettings", () => ({
    useSiteSettings: () => ({ settings: { default_currency: "USD" }, loaded: true }),
}));

const { SiteCurrencyProvider, useSiteCurrency } = await import("@/core/components/currency/site-currency");
type Display = { code: string; rate: number } | null;

const STORAGE_KEY = "blysis_display_currency";
const TRY: Display = { code: "TRY", rate: 50.22 };

/** What a module does: it offers a default once it knows the operator's. */
function Price({ fallback }: { fallback: Display }) {
    const { code, chosen, format, setDefaultDisplay } = useSiteCurrency();
    useEffect(() => { setDefaultDisplay(fallback); }, [fallback, setDefaultDisplay]);
    return <p data-testid="price" data-code={code} data-chosen={String(chosen)}>{format(10)}</p>;
}

function Chooser() {
    const { setDisplay } = useSiteCurrency();
    return (
        <>
            <button type="button" onClick={() => setDisplay({ code: "EUR", rate: 0.89 })}>eur</button>
            <button type="button" onClick={() => setDisplay(null)}>clear</button>
        </>
    );
}

const tree = (fallback: Display) => (
    <SiteCurrencyProvider>
        <Price fallback={fallback} />
        <Chooser />
    </SiteCurrencyProvider>
);

const shownCode = () => screen.getByTestId("price").getAttribute("data-code");

beforeEach(() => {
    window.localStorage.clear();
});

describe("the currency a new visitor reads", () => {
    it("is the site's default once the page has mounted", async () => {
        render(tree(TRY));
        await act(async () => {});
        expect(shownCode()).toBe("TRY");
        expect(screen.getByTestId("price").textContent).toContain("502.20");
    });

    it("is never written down as the visitor's own choice", async () => {
        render(tree(TRY));
        await act(async () => {});
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
        expect(screen.getByTestId("price").getAttribute("data-chosen")).toBe("false");
    });

    it("gives way to a currency the visitor picked before", async () => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: "EUR", rate: 0.89 }));
        render(tree(TRY));
        await act(async () => {});
        expect(shownCode()).toBe("EUR");
        expect(screen.getByTestId("price").getAttribute("data-chosen")).toBe("true");
    });

    it("gives way to a pick made on the page, and comes back when the pick is cleared", async () => {
        render(tree(TRY));
        await act(async () => {});
        await act(async () => { screen.getByText("eur").click(); });
        expect(shownCode()).toBe("EUR");
        await act(async () => { screen.getByText("clear").click(); });
        expect(shownCode()).toBe("TRY");
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("is the base when the site sets no default", async () => {
        render(tree(null));
        await act(async () => {});
        expect(shownCode()).toBe("USD");
    });
});

describe("the first render", () => {
    it("is the base on the server, whatever the default and the storage say", () => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: "EUR", rate: 0.89 }));
        const html = renderToString(tree(TRY));
        expect(html).toContain('data-code="USD"');
    });

    it("draws in the browser what the server drew", () => {
        // Effects have not run on the first pass, so neither the stored
        // choice nor the default has been applied: the text React hydrates
        // against is the server's text.
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: "EUR", rate: 0.89 }));
        const served = renderToString(tree(TRY));
        const container = document.createElement("div");
        container.innerHTML = served;
        const first = container.querySelector("[data-testid=price]")?.outerHTML;
        expect(first).toContain('data-code="USD"');
        expect(served).toContain(first ?? "missing");
    });
});
