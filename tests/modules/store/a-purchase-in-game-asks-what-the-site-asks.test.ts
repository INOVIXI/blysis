// @vitest-environment node
/**
 * A purchase made in game is held to what the site's checkout holds it to.
 *
 * The menu in game draws the product's questions from the catalogue, but a
 * menu is not a check: the answers are read again here, a select answer has
 * to be one of its options, a number has to be a number, and nothing longer
 * than a chat line gets into a command. A product the operator did not put
 * in the game is not for sale there, whatever id a client sends.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
    product: { findFirst: vi.fn() },
    user: { findUnique: vi.fn(async () => ({ receiveGifts: true })) },
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    moduleSettings: vi.fn(async () => ({ enableChestGifting: true })),
    logActivity: vi.fn(),
}));
vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (_hook: string, value: unknown) => value),
    doActionAsync: vi.fn(async () => undefined),
    generateOrderNumber: () => "ORD-1",
}));

const { invalidField, optionsOf, purchaseWithCredits, MAX_GAME_QUANTITY } = await import("@/modules/store/lib/credit-purchase");

const field = (over: Partial<{ name: string; type: string; required: boolean; options: string | null }>) => ({
    name: "realm",
    label: "Realm",
    type: "text",
    required: false,
    options: null,
    ...over,
});

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

const inGame = { id: "p1", isActive: true, showInGame: true, giftable: false, type: "ONE_TIME", category: { id: "c1", showInGame: true } };

beforeEach(() => {
    vi.clearAllMocks();
    db.product.findFirst.mockResolvedValue(inGame);
});

describe("the options of a select", () => {
    it("are read from JSON or from a comma list, trimmed", () => {
        expect(optionsOf('["red", " blue "]')).toEqual(["red", "blue"]);
        expect(optionsOf("red, blue,,")).toEqual(["red", "blue"]);
        expect(optionsOf(null)).toEqual([]);
    });
});

describe("the answers to a product's questions", () => {
    it("name the first required question left empty", () => {
        expect(invalidField([field({ required: true })], { realm: "  " })).toBe("realm");
    });

    it("let an optional question stay empty", () => {
        expect(invalidField([field({})], {})).toBeNull();
    });

    it("refuse a number that is not one", () => {
        expect(invalidField([field({ type: "number" })], { realm: "12a" })).toBe("realm");
        expect(invalidField([field({ type: "number" })], { realm: "-12.5" })).toBeNull();
    });

    it("refuse a select answer that is not among its options", () => {
        const select = field({ type: "select", options: "north,south" });
        expect(invalidField([select], { realm: "east" })).toBe("realm");
        expect(invalidField([select], { realm: "south" })).toBeNull();
    });

    it("refuse an answer longer than a chat line", () => {
        expect(invalidField([field({})], { realm: "x".repeat(101) })).toBe("realm");
    });
});

describe("a purchase in game", () => {
    it("is refused for a product that is not on sale", async () => {
        db.product.findFirst.mockResolvedValue(null);
        await expect(purchaseWithCredits(request)).resolves.toMatchObject({ ok: false, code: "not_found" });
    });

    it("is refused for a product the operator kept out of the game", async () => {
        db.product.findFirst.mockResolvedValue({ ...inGame, showInGame: false });
        await expect(purchaseWithCredits(request)).resolves.toMatchObject({ ok: false, code: "not_in_game" });
    });

    it("is refused when its shelf is kept out of the game", async () => {
        db.product.findFirst.mockResolvedValue({ ...inGame, category: { id: "c1", showInGame: false } });
        await expect(purchaseWithCredits(request)).resolves.toMatchObject({ ok: false, code: "not_in_game" });
    });

    it("is refused for a subscription, which credits cannot renew", async () => {
        db.product.findFirst.mockResolvedValue({ ...inGame, type: "SUBSCRIPTION" });
        await expect(purchaseWithCredits(request)).resolves.toMatchObject({ ok: false, code: "not_in_game" });
    });

    it("is refused for a quantity outside one to the cap", async () => {
        for (const quantity of [0, -1, 1.5, MAX_GAME_QUANTITY + 1]) {
            await expect(purchaseWithCredits({ ...request, quantity })).resolves.toMatchObject({ ok: false, code: "quantity_invalid" });
        }
    });

    it("is refused as a gift when the product does not travel", async () => {
        await expect(purchaseWithCredits({ ...request, recipientId: "u2" })).resolves.toMatchObject({ ok: false, code: "not_giftable" });
    });

    it("is refused as a gift to a member who takes none", async () => {
        db.product.findFirst.mockResolvedValue({ ...inGame, giftable: true });
        db.user.findUnique.mockResolvedValue({ receiveGifts: false });
        await expect(purchaseWithCredits({ ...request, recipientId: "u2" })).resolves.toMatchObject({
            ok: false,
            code: "recipient_refuses_gifts",
        });
    });
});
