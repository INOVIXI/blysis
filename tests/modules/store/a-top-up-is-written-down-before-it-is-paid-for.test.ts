// @vitest-environment node
/**
 * A top-up is written down before any gateway is asked to take money for it.
 *
 * The reference a gateway carried for a top-up was the buyer's id, and the
 * credits travelled as metadata. Most gateways have no field for metadata and
 * report every payment as an order, so a top-up paid through them came back
 * as an order nobody had placed: the money was taken, nothing was credited,
 * and the buyer was told it worked. The store now writes a `CreditTopUp` row
 * first and hands the gateway its id, so whatever the gateway can or cannot
 * carry, the settlement finds the credits, the buyer and the price.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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
    creditTopUp: { create: vi.fn(async () => ({ id: "topup-1" })) },
    user: { findUnique: vi.fn(async () => ({ email: "buyer@example.com", username: "Steve" })) },
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    moduleSettings: vi.fn(async () => ({ creditsPricePerUnit: 0.01 })),
    rateLimitForRole: vi.fn(async () => ({ success: true })),
    readJsonBody: vi.fn(async (request: Request) => request.json()),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "user-1", role: "member" } })) }));

const startPaymentSession = vi.fn(async () => ({
    handled: true,
    redirectUrl: "https://pay.example/checkout",
    reference: "gw-1",
    error: null,
}));
vi.mock("@/modules/store/lib/payments", () => ({
    startPaymentSession: (...args: unknown[]) => startPaymentSession(...(args as [])),
    isPaymentProviderAvailable: vi.fn(async () => true),
    listPaymentProviders: vi.fn(async () => [{ id: "iyzico", label: "iyzico" }]),
}));

const { POST } = await import("@/modules/store/api/credits/buy/route");

function buy(body: Record<string, unknown>) {
    return POST(
        new NextRequest("https://shop.example/api/v1/store/credits/buy", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        }),
    );
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("buying credits", () => {
    it("writes the top-up down with what it sells and what it costs", async () => {
        const res = await buy({ packageId: "pack-1", provider: "iyzico" });

        expect(res.status).toBe(200);
        expect(db.creditTopUp.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: { userId: "user-1", credits: 1200, amount: 9.99, currency: "USD", provider: "iyzico" },
            }),
        );
    });

    it("hands the gateway the top-up's id, not the buyer's", async () => {
        await buy({ packageId: "pack-1", provider: "iyzico" });

        expect(startPaymentSession).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "credits", reference: "topup-1", amount: 9.99, currency: "USD" }),
        );
    });

    it("writes it before the gateway is asked", async () => {
        await buy({ packageId: "pack-1", provider: "iyzico" });

        const written = db.creditTopUp.create.mock.invocationCallOrder[0];
        const asked = startPaymentSession.mock.invocationCallOrder[0];
        expect(written).toBeLessThan(asked);
    });

    it("writes nothing for a package that is not for sale", async () => {
        db.creditPackage.findUnique.mockResolvedValueOnce(null as never);

        const res = await buy({ packageId: "gone", provider: "iyzico" });

        expect(res.status).toBe(400);
        expect(db.creditTopUp.create).not.toHaveBeenCalled();
        expect(startPaymentSession).not.toHaveBeenCalled();
    });
});
