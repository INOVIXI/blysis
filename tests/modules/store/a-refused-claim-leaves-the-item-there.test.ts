/**
 * Refusing to deliver something must not consume it.
 *
 * The claim - the conditional write that flips `isRedeemed` - exists so two
 * requests arriving together cannot both run the product's commands. It has
 * to happen before delivery, and it did.
 *
 * What it must not happen before is a refusal. Asking "which player?" after
 * claiming means the answer arrives at an item that is already spent: the
 * screen asks, the person types a name, and the second attempt is told the
 * item was already redeemed. They paid for it and it is gone, having been
 * delivered to nobody.
 *
 * So anything the request can be turned away for is decided first, and the
 * claim is the last thing before the commands run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
    chestItem: { findUnique: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    productCommand: { findMany: vi.fn(async () => [] as { command: string; serverId: string | null }[]) },
    user: { findMany: vi.fn(async () => []) },
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    rateLimitForRole: vi.fn(async () => ({ success: true })),
    readJsonBody: vi.fn(async (request: Request) => request.json().catch(() => ({}))),
}));
vi.mock("@/core/sdk/auth", () => ({
    auth: vi.fn(async () => ({ user: { id: "member-1", name: "shotmember", role: "member" } })),
}));
const deliverProduct = vi.fn(async () => ({ ok: true }));
vi.mock("@/modules/store/lib/delivery", () => ({ deliverProduct }));

const { POST } = await import("@/modules/store/api/chest/[id]/route");

const claim = (body: Record<string, unknown> = {}) =>
    POST(
        new Request("http://localhost/api/v1/chest/chest-1", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }) as never,
        { params: Promise.resolve({ id: "chest-1" }) },
    );

/** A row nobody bought, so no name was ever recorded for it. */
const byHand = {
    id: "chest-1",
    userId: "member-1",
    productId: "prod-1",
    productName: "Rare key",
    quantity: 1,
    playerName: null,
    variables: null,
    isRedeemed: false,
};

beforeEach(() => {
    vi.clearAllMocks();
    db.chestItem.findUnique.mockResolvedValue(byHand);
    db.chestItem.updateMany.mockResolvedValue({ count: 1 });
    db.productCommand.findMany.mockResolvedValue([{ command: "give {player} key", serverId: null }]);
});

describe("claiming something with nobody recorded", () => {
    it("asks rather than delivering to the account's username", async () => {
        const res = await claim();
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({ code: "chest_needs_player_name" });
        expect(deliverProduct).not.toHaveBeenCalled();
    });

    it("leaves the item in the chest, so the answer has something to arrive at", async () => {
        await claim();
        expect(db.chestItem.updateMany).not.toHaveBeenCalled();
    });

    it("delivers on the second attempt, once a name is given", async () => {
        await claim();
        vi.clearAllMocks();
        db.chestItem.findUnique.mockResolvedValue(byHand);
        db.chestItem.updateMany.mockResolvedValue({ count: 1 });
        db.productCommand.findMany.mockResolvedValue([{ command: "give {player} key", serverId: null }]);

        const res = await claim({ playerName: "Alex_MC" });

        expect(res.status).toBe(200);
        expect(deliverProduct).toHaveBeenCalledWith(
            expect.objectContaining({ playerName: "Alex_MC" }),
        );
    });
});

describe("claiming something that names its player", () => {
    it("still claims before it delivers, so two requests cannot both run it", async () => {
        db.chestItem.findUnique.mockResolvedValue({ ...byHand, playerName: "Steve_MC" });
        const order: string[] = [];
        db.chestItem.updateMany.mockImplementation(async () => { order.push("claim"); return { count: 1 }; });
        deliverProduct.mockImplementation(async () => { order.push("deliver"); return { ok: true }; });

        await claim();

        expect(order).toEqual(["claim", "deliver"]);
    });

    it("delivers nothing when somebody else claimed it first", async () => {
        db.chestItem.findUnique.mockResolvedValue({ ...byHand, playerName: "Steve_MC" });
        db.chestItem.updateMany.mockResolvedValue({ count: 0 });

        const res = await claim();

        expect(res.status).toBe(400);
        expect(deliverProduct).not.toHaveBeenCalled();
    });
});
