/**
 * Not everything in a chest may be handed to somebody else.
 *
 * Gifting was unconditional. Every unclaimed row carried a Gift button and
 * the endpoint moved whatever it was asked to move, so a rank tied to one
 * account and a key bought at a member price travelled as easily as a crate
 * key, and a site that did not want gifting at all had no way to say so.
 *
 * Two questions, because they are different: a site decides whether gifting
 * exists (`enableChestGifting`), and a product decides whether it is one of
 * the things that travels (`giftable`). Both are asked at the endpoint rather
 * than taken from the screen - a hidden button is not a check - and both are
 * answered again in the listing, so the button is not drawn on something that
 * will be refused after the click.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
    chestItem: {
        findUnique: vi.fn(),
        findMany: vi.fn(async () => [] as unknown[]),
        updateMany: vi.fn(async () => ({ count: 1 })),
    },
    product: { findUnique: vi.fn(), findMany: vi.fn(async () => [] as unknown[]) },
    productCommand: { findMany: vi.fn(async () => []) },
    user: { findFirst: vi.fn(async () => ({ id: "member-2", username: "alex" })) },
};

/** What the operator has said about gifting. Absent means never asked. */
let settings: Record<string, unknown> = {};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    rateLimitForRole: vi.fn(async () => ({ success: true })),
    readJsonBody: vi.fn(async (request: Request) => request.json().catch(() => ({}))),
    moduleSettings: vi.fn(async () => settings),
}));
vi.mock("@/core/sdk/auth", () => ({
    auth: vi.fn(async () => ({ user: { id: "member-1", name: "steve", role: "member" } })),
}));
vi.mock("@/modules/store/lib/delivery", () => ({ deliverProduct: vi.fn(async () => ({ ok: true })) }));

const { POST } = await import("@/modules/store/api/chest/[id]/route");
const { GET } = await import("@/modules/store/api/chest/route");

/** A bought-and-unclaimed row belonging to the member who is signed in. */
const unclaimed = {
    id: "chest-1",
    userId: "member-1",
    productId: "prod-1",
    productName: "VIP",
    quantity: 1,
    playerName: "steve",
    variables: null,
    isRedeemed: false,
};

const giveAway = () =>
    POST(
        new Request("http://localhost/api/v1/chest/chest-1", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ giftTo: "alex" }),
        }) as never,
        { params: Promise.resolve({ id: "chest-1" }) },
    );

beforeEach(() => {
    vi.clearAllMocks();
    settings = {};
    db.chestItem.findUnique.mockResolvedValue(unclaimed);
    db.chestItem.findMany.mockResolvedValue([unclaimed]);
    db.chestItem.updateMany.mockResolvedValue({ count: 1 });
    db.product.findUnique.mockResolvedValue({ giftable: true });
    db.product.findMany.mockResolvedValue([{ id: "prod-1" }]);
    db.user.findFirst.mockResolvedValue({ id: "member-2", username: "alex" });
});

describe("giving away something from the chest", () => {
    it("moves it when the product travels and the site allows it", async () => {
        const res = await giveAway();

        expect(res.status).toBe(200);
        expect(db.chestItem.updateMany).toHaveBeenCalled();
    });

    it("is refused when the product says it does not travel", async () => {
        db.product.findUnique.mockResolvedValue({ giftable: false });

        const res = await giveAway();

        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toMatchObject({ code: "chest_item_not_giftable" });
    });

    it("leaves the item where it was when it is refused", async () => {
        db.product.findUnique.mockResolvedValue({ giftable: false });

        await giveAway();

        expect(db.chestItem.updateMany).not.toHaveBeenCalled();
    });

    it("is refused for everything when the site has turned gifting off", async () => {
        settings = { enableChestGifting: false };

        const res = await giveAway();

        expect(res.status).toBe(403);
        await expect(res.json()).resolves.toMatchObject({ code: "chest_gifting_off" });
        expect(db.chestItem.updateMany).not.toHaveBeenCalled();
    });

    it("is refused when the product is gone, rather than moved on a guess", async () => {
        db.product.findUnique.mockResolvedValue(null);

        expect((await giveAway()).status).toBe(403);
    });
});

describe("the chest as the screen reads it", () => {
    it("marks a row that may be given away", async () => {
        const body = await (await GET()).json();

        expect(body.giftingEnabled).toBe(true);
        expect(body.items[0]).toMatchObject({ id: "chest-1", canGift: true });
    });

    it("marks a row whose product does not travel, so no button is drawn on it", async () => {
        db.product.findMany.mockResolvedValue([]);

        const body = await (await GET()).json();

        expect(body.items[0].canGift).toBe(false);
    });

    it("says gifting is off without asking the database which products travel", async () => {
        settings = { enableChestGifting: false };

        const body = await (await GET()).json();

        expect(body.giftingEnabled).toBe(false);
        expect(body.items[0].canGift).toBe(false);
        expect(db.product.findMany).not.toHaveBeenCalled();
    });
});
