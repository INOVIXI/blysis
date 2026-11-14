// @vitest-environment node
/**
 * A typed top-up is priced, limited and given its bonus by one function, and
 * the buy route charges what the screen previewed.
 *
 * Before the load-credits page there was no screen for a typed amount, and the
 * route had its own rules: 1 to 100,000 credits and an English "$0.50" floor,
 * whatever the site's currency. The limits are now the operator's, in money,
 * and `quoteTopUp` answers for both the page and the route, so the price, the
 * credits and the campaign bonus the buyer was shown are the ones written on
 * the top-up and sent to the gateway.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const RUNNING = {
    id: "weekend",
    name: "Weekend",
    startsAt: new Date("2020-01-01T00:00:00Z"),
    endsAt: new Date("2099-01-01T00:00:00Z"),
    isActive: true,
    tiers: [{ minAmount: 100, percent: 5 }, { minAmount: 250, percent: 10 }],
};

const settings = { current: {} as Record<string, unknown> };

const db = {
    setting: { findUnique: vi.fn(async () => ({ value: "TRY" })) },
    creditPackage: {
        findUnique: vi.fn(async () => ({ id: "tiny", name: "Tiny", credits: 10, bonusCredits: 0, price: 0.25, isActive: true })),
    },
    creditBonusCampaign: { findMany: vi.fn(async (): Promise<unknown[]> => [RUNNING]) },
    creditTopUp: { create: vi.fn(async () => ({ id: "topup-1" })) },
    user: { findUnique: vi.fn(async () => ({ email: "buyer@example.com", username: "Steve" })) },
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    moduleSettings: vi.fn(async () => settings.current),
    rateLimitForRole: vi.fn(async () => ({ success: true })),
    readJsonBody: vi.fn(async (request: Request) => request.json()),
    siteTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "user-1", role: "member" } })) }));

const startPaymentSession = vi.fn(async () => ({ handled: true, redirectUrl: "https://pay.example/checkout", reference: "gw-1", error: null }));
vi.mock("@/modules/store/lib/payments", () => ({
    startPaymentSession: (...args: unknown[]) => startPaymentSession(...(args as [])),
    isPaymentProviderAvailable: vi.fn(async () => true),
    listPaymentProviders: vi.fn(async () => [{ id: "iyzico", label: "iyzico" }]),
}));

const { POST } = await import("@/modules/store/api/credits/buy/route");
const { creditsFor, quoteTopUp, readPresets, readTopUpLimits, MIN_CHARGE } = await import("@/modules/store/lib/credit-top-up-quote");

function buy(body: Record<string, unknown>) {
    return POST(
        new NextRequest("https://shop.example/api/v1/store/credits/buy", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        }),
    );
}

type Row = { data: { credits: number; amount: number; bonusCredits: number; bonusCampaignId: string | null } };
const written = () => (db.creditTopUp.create.mock.calls.at(-1) as unknown as [Row])[0].data;
const charged = () => (startPaymentSession.mock.calls.at(-1) as unknown as [{ amount: number }])[0].amount;

beforeEach(() => {
    vi.clearAllMocks();
    settings.current = { creditsPricePerUnit: 1, creditsTopUpMin: 10, creditsTopUpMax: 1000, creditsTopUpPresets: "50, 100, 250", creditsTopUpTyped: true };
    db.creditBonusCampaign.findMany.mockResolvedValue([RUNNING]);
});

describe("the limits an operator sets", () => {
    it("are read in money, with the gateway's floor under the min and the min under the max", () => {
        expect(readTopUpLimits({ creditsTopUpMin: 0.1, creditsTopUpMax: 5 })).toMatchObject({ min: MIN_CHARGE, max: 5 });
        expect(readTopUpLimits({ creditsTopUpMin: 100, creditsTopUpMax: 20 })).toMatchObject({ min: 100, max: 100 });
        expect(readTopUpLimits({})).toMatchObject({ pricePerUnit: 0.01, min: 1, max: 10000, presets: [], typed: true });
    });

    it("offer only the presets that are numbers inside them, once each and in order", () => {
        expect(readPresets("250, 50;abc 50 5 2000 99.999", 10, 1000)).toEqual([50, 100, 250]);
    });

    it("refuse a typed amount below the min, naming the min", async () => {
        const res = await buy({ amount: 5 });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: "credit_top_up_below_min", min: 10 });
        expect(db.creditTopUp.create).not.toHaveBeenCalled();
    });

    it("refuse a typed amount above the max, naming the max", async () => {
        const res = await buy({ amount: 1001 });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: "credit_top_up_above_max", max: 1000 });
    });

    it("let only a preset through when typing is off", async () => {
        settings.current = { ...settings.current, creditsTopUpTyped: false };
        const typed = await buy({ amount: 77 });
        expect(await typed.json()).toMatchObject({ code: "credit_top_up_typed_off" });
        const preset = await buy({ amount: 100 });
        expect(preset.status).toBe(200);
    });

    it("leave a package to its own price, above the gateway's floor", async () => {
        const res = await buy({ packageId: "tiny" });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: "credit_top_up_below_min", min: MIN_CHARGE });
    });
});

describe("what the screen previews", () => {
    it("is what the top-up is written with and the gateway is asked for", async () => {
        // A price that is not a round fraction, where rounding twice diverges.
        settings.current = { ...settings.current, creditsPricePerUnit: 0.013 };
        const limits = readTopUpLimits(settings.current);
        const preview = quoteTopUp(creditsFor(260, limits.pricePerUnit), limits, [RUNNING], new Date());
        expect(preview.credits).toBe(20000);
        expect(preview.paid).toBe(260);
        expect(preview.bonus).toMatchObject({ campaignId: "weekend", percent: 10, credits: 2000 });

        const res = await buy({ amount: preview.credits });
        expect(res.status).toBe(200);
        expect(written()).toMatchObject({ credits: preview.credits, amount: preview.paid, bonusCredits: 2000, bonusCampaignId: "weekend" });
        expect(charged()).toBe(preview.paid);
    });

    it("rounds money down to whole credits and charges only those", () => {
        const limits = readTopUpLimits({ creditsPricePerUnit: 0.013, creditsTopUpMin: 1, creditsTopUpMax: 1000 });
        const quote = quoteTopUp(creditsFor(10, limits.pricePerUnit), limits, [], new Date());
        expect(quote.credits).toBe(769);
        expect(quote.paid).toBe(10);
        expect(quoteTopUp(creditsFor(10, 0.01), { ...limits, pricePerUnit: 0.01 }, [], new Date()).credits).toBe(1000);
    });

    it("names the next tier and how much more it takes, and nothing past the top", () => {
        const limits = readTopUpLimits(settings.current);
        const now = new Date();
        expect(quoteTopUp(80, limits, [RUNNING], now).next).toEqual({ percent: 5, missing: 20 });
        expect(quoteTopUp(120, limits, [RUNNING], now).next).toEqual({ percent: 10, missing: 130 });
        expect(quoteTopUp(300, limits, [RUNNING], now).next).toBeNull();
        expect(quoteTopUp(80, limits, [{ ...RUNNING, endsAt: new Date(now.getTime() - 1) }], now).next).toBeNull();
    });
});
