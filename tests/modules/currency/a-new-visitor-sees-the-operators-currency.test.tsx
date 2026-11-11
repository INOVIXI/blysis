// @vitest-environment jsdom
/**
 * A visitor who never picked a currency reads prices in the one the operator
 * chose, and in their own language's one where the operator named it.
 *
 * Prices are entered in the site's base. A shop priced in dollars and read
 * mostly in Turkish showed every new visitor dollars, because a visitor with
 * nothing stored got the base. The operator can now name the currency a new
 * visitor reads, and one per language; the picker hands it to core as a
 * default that is never stored, so a visitor's own pick still wins and a
 * later change of the default still reaches everyone else.
 *
 * A visitor's stored pick carries the rate of the day it was made. It is
 * quoted again from the current list, so a lira picked last month is not
 * shown at last month's rate.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

const core = {
    base: "USD",
    code: "USD",
    chosen: false,
    setDisplay: vi.fn(),
    setDefaultDisplay: vi.fn(),
};
let locale = "tr";

vi.mock("next-intl", () => ({ useLocale: () => locale }));
vi.mock("@/core/sdk/server", () => ({
    prisma: { setting: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => null) } },
    isAdmin: vi.fn(async () => true),
    readJsonBody: vi.fn(async (request: Request) => request.json()),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", role: "admin" } })) }));
vi.mock("@/core/sdk/ui", () => ({
    useSiteCurrency: () => core,
    FooterDropdown: () => null,
}));

const { defaultDisplayFor, quote } = await import("@/modules/currency/lib/default-display");
const { CurrencySelector } = await import("@/modules/currency/components/CurrencySelector");
const { POST } = await import("@/modules/currency/api/route");

const USD = { code: "USD", name: "US Dollar", symbol: "$", rate: 1, enabled: true };
const EUR = { code: "EUR", name: "Euro", symbol: "€", rate: 0.89, enabled: true };
const TRY = { code: "TRY", name: "Turkish Lira", symbol: "₺", rate: 50.22, enabled: true };

const config = (extra: Record<string, unknown> = {}) => ({ base: "USD", currencies: [USD, EUR, TRY], ...extra });

beforeEach(() => {
    core.code = "USD";
    core.chosen = false;
    core.setDisplay.mockClear();
    core.setDefaultDisplay.mockClear();
    locale = "tr";
});

describe("the currency a new visitor reads", () => {
    it("is the base when the operator chose nothing", () => {
        expect(defaultDisplayFor(config(), "tr", "USD")).toBeNull();
    });

    it("is the operator's default, quoted against the site's base", () => {
        expect(defaultDisplayFor(config({ defaultDisplay: "TRY" }), "en", "USD")).toEqual({ code: "TRY", rate: 50.22 });
    });

    it("is the visitor's language's currency over the site default", () => {
        const set = config({ defaultDisplay: "EUR", languageDisplay: { tr: "TRY" } });
        expect(defaultDisplayFor(set, "tr", "USD")).toEqual({ code: "TRY", rate: 50.22 });
        expect(defaultDisplayFor(set, "de", "USD")).toEqual({ code: "EUR", rate: 0.89 });
    });

    it("is the base when the chosen currency is switched off", () => {
        const set = config({ defaultDisplay: "TRY", currencies: [USD, { ...TRY, enabled: false }] });
        expect(defaultDisplayFor(set, "tr", "USD")).toBeNull();
    });

    it("is quoted through the site's base when the list has another base", () => {
        // The list is quoted in lira; the site charges in dollars. One dollar
        // is 50 lira, so a euro display is 0.0178 / 0.02 euro per dollar.
        const set = {
            base: "TRY",
            defaultDisplay: "EUR",
            currencies: [{ ...TRY, rate: 1 }, { ...USD, rate: 0.02 }, { ...EUR, rate: 0.0178 }],
        };
        expect(defaultDisplayFor(set, "tr", "USD")?.rate).toBeCloseTo(0.0178 / 0.02, 12);
    });

    it("is nothing when the site's base is not in the list", () => {
        expect(quote(config({ currencies: [EUR, TRY] }), "TRY", "USD")).toBeNull();
    });
});

describe("the footer picker", () => {
    function answer(body: unknown) {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    }

    it("hands core the default without storing it as the visitor's pick", async () => {
        answer(config({ languageDisplay: { tr: "TRY" } }));
        render(<CurrencySelector />);
        await act(async () => {});
        expect(core.setDefaultDisplay).toHaveBeenLastCalledWith({ code: "TRY", rate: 50.22 });
        expect(core.setDisplay).not.toHaveBeenCalled();
    });

    it("re-quotes a stored pick at today's rate", async () => {
        core.code = "TRY";
        core.chosen = true;
        answer(config());
        render(<CurrencySelector />);
        await act(async () => {});
        expect(core.setDisplay).toHaveBeenLastCalledWith({ code: "TRY", rate: 50.22 });
    });

    it("leaves a stored pick of the base alone", async () => {
        core.chosen = true;
        answer(config({ defaultDisplay: "TRY" }));
        render(<CurrencySelector />);
        await act(async () => {});
        expect(core.setDisplay).not.toHaveBeenCalled();
    });
});

describe("saving the choice", () => {
    async function saved(body: unknown) {
        const res = await POST(new Request("http://localhost/api/v1/currency", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }) as never);
        return { status: res.status, body: await res.json() };
    }

    it("keeps the base for a site that says nothing", async () => {
        const { body } = await saved(config());
        expect(body.defaultDisplay).toBe("");
        expect(body.languageDisplay).toEqual({});
    });

    it("stores a default and a language's currency", async () => {
        const { body } = await saved(config({ defaultDisplay: "EUR", languageDisplay: { tr: "TRY" } }));
        expect(body.defaultDisplay).toBe("EUR");
        expect(body.languageDisplay).toEqual({ tr: "TRY" });
    });

    it("lets go of a choice whose currency is switched off or gone", async () => {
        // A default the site does not offer would leave the picker showing a
        // currency it cannot list. It falls back to the base instead.
        const { body } = await saved(config({
            currencies: [USD, { ...EUR, enabled: false }, TRY],
            defaultDisplay: "EUR",
            languageDisplay: { tr: "TRY", de: "GBP" },
        }));
        expect(body.defaultDisplay).toBe("");
        expect(body.languageDisplay).toEqual({ tr: "TRY" });
    });

    it("refuses a language that is not a language tag", async () => {
        const { status } = await saved(config({ languageDisplay: { "../x": "TRY" } }));
        expect(status).toBe(400);
    });
});
