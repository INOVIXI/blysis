// @vitest-environment node
/**
 * A campaign bonus is decided when a top-up starts, paid once when it
 * settles, and taken back with a refund.
 *
 * A gateway settles minutes later, days later for a transfer confirmed by
 * hand. A campaign that ended in between must still pay what the buyer was
 * shown, so the bonus is written on the top-up when the payment starts and
 * settling never looks at the campaigns. Settling is retried by design, so
 * the bonus has its own ledger id and rides the same claim as the credits.
 * A refund takes it back with the credits, as far as the balance allows,
 * the same as `refundTopUp` does for the credits alone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const RUNNING = {
    id: "weekend",
    name: "Weekend",
    startsAt: new Date("2020-01-01T00:00:00Z"),
    endsAt: new Date("2099-01-01T00:00:00Z"),
    isActive: true,
    tiers: [{ minAmount: 5, percent: 10 }, { minAmount: 9, percent: 20 }],
};

const db = {
    setting: { findUnique: vi.fn(async () => ({ value: "USD" })) },
    creditPackage: {
        findUnique: vi.fn(async () => ({
            id: "pack-1",
            name: "Big pack",
            credits: 1000,
            bonusCredits: 200,
            price: 9.99,
            isActive: true,
        })),
    },
    creditBonusCampaign: { findMany: vi.fn(async (): Promise<unknown[]> => [RUNNING]) },
    creditTopUp: {
        create: vi.fn(async () => ({ id: "topup-1" })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findFirst: vi.fn(async (): Promise<unknown> => null),
    },
    user: { findUnique: vi.fn(async (): Promise<unknown> => ({ email: "buyer@example.com", username: "Steve", creditBalance: 5000 })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    moduleSettings: vi.fn(async () => ({ creditsPricePerUnit: 0.01 })),
    rateLimitForRole: vi.fn(async () => ({ success: true })),
    readJsonBody: vi.fn(async (request: Request) => request.json()),
    siteTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "user-1", role: "member" } })) }));

/** The wallet is another module's; what the store asks of it is what is seen here. */
const applyFiltersAsync = vi.fn(async (_hook: string, value: unknown) => value);
vi.mock("@/core/sdk", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    applyFiltersAsync,
    doActionAsync: vi.fn(async () => {}),
}));

vi.mock("@/modules/store/lib/payments", () => ({
    startPaymentSession: vi.fn(async () => ({ handled: true, redirectUrl: "https://pay.example/checkout", reference: "gw-1", error: null })),
    isPaymentProviderAvailable: vi.fn(async () => true),
    listPaymentProviders: vi.fn(async () => [{ id: "iyzico", label: "iyzico" }]),
}));

const { POST } = await import("@/modules/store/api/credits/buy/route");
const { settleCredits, refundTopUp } = await import("@/modules/store/lib/credit-top-up");

function buy(body: Record<string, unknown>) {
    return POST(
        new NextRequest("https://shop.example/api/v1/store/credits/buy", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        }),
    );
}

/** The `credit.change` requests the store made, in order. */
function changes() {
    return applyFiltersAsync.mock.calls
        .filter(([hook]) => hook === "credit.change")
        .map(([, , request]) => request as unknown as { amount: number; type: string; ledgerId: string });
}

const settled: PaymentSettlement = {
    kind: "credits",
    reference: "topup-1",
    provider: "iyzico",
    providerRef: "pay_1",
    amount: 9.99,
    currency: "USD",
    metadata: {},
};

const topUp = {
    id: "topup-1",
    userId: "user-1",
    credits: 1200,
    amount: 9.99,
    fee: 0,
    currency: "USD",
    status: "PENDING",
    bonusCredits: 200,
};

beforeEach(() => {
    vi.clearAllMocks();
    db.creditBonusCampaign.findMany.mockResolvedValue([RUNNING]);
    db.creditTopUp.updateMany.mockResolvedValue({ count: 1 });
    applyFiltersAsync.mockImplementation(async (_hook: string, value: unknown) => value);
});

describe("when the payment starts", () => {
    it("writes the bonus on the top-up, of the package's credits and not its own bonus", async () => {
        // 9.99 reaches the 20% tier; 20% of the 1000 bought is 200, not 240.
        expect((await buy({ packageId: "pack-1", provider: "iyzico" })).status).toBe(200);

        expect(db.creditTopUp.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ credits: 1200, bonusCredits: 200, bonusCampaignId: "weekend" }),
            }),
        );
    });

    it("gives a typed amount the bonus of the tier its price reaches", async () => {
        // 600 credits at 0.01 is 6.00: the 10% tier.
        await buy({ amount: 600, provider: "iyzico" });

        expect(db.creditTopUp.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ credits: 600, bonusCredits: 60 }) }),
        );
    });

    it("writes no bonus for a campaign whose end has passed, even if the read returns it", async () => {
        db.creditBonusCampaign.findMany.mockResolvedValueOnce([{ ...RUNNING, endsAt: new Date("2021-01-01T00:00:00Z") }]);

        await buy({ packageId: "pack-1", provider: "iyzico" });

        expect(db.creditTopUp.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ bonusCredits: 0, bonusCampaignId: null }) }),
        );
    });

    it("writes no bonus when no campaign runs", async () => {
        db.creditBonusCampaign.findMany.mockResolvedValueOnce([]);

        await buy({ packageId: "pack-1", provider: "iyzico" });

        expect(db.creditTopUp.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ bonusCredits: 0, bonusCampaignId: null }) }),
        );
    });
});

describe("when the payment settles", () => {
    it("pays the bonus written at the start, after the campaign has ended", async () => {
        db.creditBonusCampaign.findMany.mockResolvedValue([]);

        await settleCredits(settled, topUp);

        expect(db.creditBonusCampaign.findMany).not.toHaveBeenCalled();
        expect(changes()).toEqual([
            expect.objectContaining({ amount: 1200, type: "credit_purchase", ledgerId: "credit:iyzico:pay_1" }),
            expect.objectContaining({ amount: 200, type: "top_up_bonus", ledgerId: "bonus:credit:iyzico:pay_1" }),
        ]);
    });

    it("pays the bonus once when the settlement arrives twice", async () => {
        await settleCredits(settled, topUp);
        // The second delivery finds the top-up already claimed.
        db.creditTopUp.updateMany.mockResolvedValueOnce({ count: 0 });
        expect(await settleCredits(settled, topUp)).toEqual({ handled: true, duplicate: true, error: null });

        expect(changes().filter((change) => change.type === "top_up_bonus")).toHaveLength(1);
    });

    it("writes no bonus row for a top-up without one", async () => {
        await settleCredits(settled, { ...topUp, bonusCredits: 0 });

        expect(changes().map((change) => change.type)).toEqual(["credit_purchase"]);
    });
});

describe("when the money goes back", () => {
    beforeEach(() => {
        db.creditTopUp.findFirst.mockResolvedValue({ id: "topup-1", userId: "user-1", credits: 1200, bonusCredits: 200, refundedAt: null });
    });

    it("takes the bonus back with the credits", async () => {
        db.user.findUnique.mockResolvedValueOnce({ creditBalance: 5000 });

        await refundTopUp("iyzico", "pay_1");

        expect(changes()).toEqual([expect.objectContaining({ amount: -1400, type: "payment_refund" })]);
    });

    it("takes back no more than the balance still holds", async () => {
        db.user.findUnique.mockResolvedValueOnce({ creditBalance: 300 });

        await refundTopUp("iyzico", "pay_1");

        expect(changes()).toEqual([expect.objectContaining({ amount: -300 })]);
    });
});
