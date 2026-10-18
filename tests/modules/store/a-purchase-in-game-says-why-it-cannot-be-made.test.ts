// @vitest-environment node
/**
 * A product that is not for sale to this member right now is a refusal a game
 * can show, never a site that "did not answer". Reported as `unavailable`
 * with no reason, a reached per-person limit read as an outage: the game
 * retried three times and told the player to check a balance nothing had
 * touched.
 */
import { describe, it, expect, vi } from "vitest";

const db = {
    product: { findFirst: vi.fn(async () => ({ id: "p1", isActive: true, showInGame: true, giftable: true, type: "ONE_TIME", category: { id: "c1", showInGame: true } })) },
    user: { findUnique: vi.fn(async () => ({ receiveGifts: true })) },
};
const availability = { state: "open", buyable: true, remainingForPerson: null as number | null, remainingInPeriod: null };

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    moduleSettings: vi.fn(async () => ({ enableChestGifting: true })),
    logActivity: vi.fn(),
    siteTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (_hook: string, value: unknown) => value),
    doActionAsync: vi.fn(async () => undefined),
    generateOrderNumber: () => "ORD-1",
}));
vi.mock("@/modules/store/lib/availability-server", () => ({
    availabilityFor: vi.fn(async () => availability),
    rulesOf: vi.fn(() => ({})),
}));

const { purchaseWithCredits } = await import("@/modules/store/lib/credit-purchase");

const request = {
    buyerId: "u1",
    productId: "p1",
    quantity: 1,
    fields: {},
    recipientId: null,
    playerName: "Steve",
    playerId: "uuid-1",
    channel: "game:survival",
};

describe("a purchase in game of something not for sale to this member now", () => {
    it("names a reached per-person limit as its own refusal", async () => {
        Object.assign(availability, { state: "limit_reached", buyable: false });
        await expect(purchaseWithCredits(request)).resolves.toMatchObject({ ok: false, code: "limit_reached" });
        await expect(purchaseWithCredits({ ...request, recipientId: "u2" })).resolves.toMatchObject({ ok: false, code: "limit_reached" });
    });

    it("names a quantity above what is left of the limit the same way", async () => {
        Object.assign(availability, { state: "open", buyable: true, remainingForPerson: 1 });
        await expect(purchaseWithCredits({ ...request, quantity: 2 })).resolves.toMatchObject({ ok: false, code: "limit_reached" });
        availability.remainingForPerson = null;
    });

    it("gives every other closed state as the reason it is unavailable", async () => {
        for (const state of ["off", "wrong_role", "needs_product", "early", "ended", "closed"]) {
            Object.assign(availability, { state, buyable: false });
            await expect(purchaseWithCredits(request)).resolves.toMatchObject({ ok: false, code: "unavailable", reason: state });
        }
    });

    it("still calls a sold-out product out of stock", async () => {
        for (const state of ["sold_out", "sold_out_for_now"]) {
            Object.assign(availability, { state, buyable: false });
            await expect(purchaseWithCredits(request)).resolves.toMatchObject({ ok: false, code: "out_of_stock" });
        }
    });
});
