/**
 * A gift reaches the member it was addressed to whatever case the sender
 * typed their name in.
 *
 * The recipient was looked up by exactly the name typed, while a username is
 * unique without regard to case everywhere else on the site. Sending to
 * `Lonely_Adam05` answered "User not found" for the member everyone knows as
 * `lonely_adam05`. A name that could mean two accounts, left from before
 * usernames were held unique that way, means neither unless one is spelled
 * exactly: a gift that cannot be taken back once accepted does not go to a
 * guess.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable } from "../game-connect/fake-prisma";

const users = fakeTable(() => ({ receiveGifts: true }), "id");
const chestItem = fakeTable(() => ({}), "id");

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        chestItem,
        product: { findUnique: async () => ({ giftable: true }) },
        user: users,
    },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    rateLimitForRole: vi.fn(async () => ({ success: true })),
    readJsonBody: vi.fn(async (request: Request) => request.json().catch(() => ({}))),
    moduleSettings: vi.fn(async () => ({})),
}));
vi.mock("@/core/sdk/auth", () => ({
    auth: vi.fn(async () => ({ user: { id: "member-1", name: "steve", role: "member" } })),
}));
vi.mock("@/modules/store/lib/delivery", () => ({ deliverProduct: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/core/sdk", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    doActionAsync: vi.fn(async () => undefined),
}));

const { POST } = await import("@/modules/store/api/chest/[id]/route");

function giveTo(name: string) {
    return POST(
        new Request("http://localhost/api/v1/chest/chest-1", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ giftTo: name }),
        }) as never,
        { params: Promise.resolve({ id: "chest-1" }) },
    );
}

function holder() {
    return chestItem.table.rows[0].userId;
}

beforeEach(() => {
    users.table.rows = [
        { id: "member-1", username: "steve" },
        { id: "member-2", username: "lonely_adam05" },
    ];
    chestItem.table.rows = [{
        id: "chest-1",
        userId: "member-1",
        productId: "prod-1",
        productName: "VIP",
        quantity: 1,
        isRedeemed: false,
        giftState: null,
    }];
});

describe("giving something from the chest to a member by name", () => {
    it("finds them when the name is typed with other capitals", async () => {
        const res = await giveTo("Lonely_Adam05");

        expect(res.status).toBe(200);
        expect(holder()).toBe("member-2");
    });

    it("still finds them by their id", async () => {
        expect((await giveTo("member-2")).status).toBe(200);
        expect(holder()).toBe("member-2");
    });

    it("goes to the exact spelling when two accounts differ only by case", async () => {
        users.table.rows.push({ id: "member-3", username: "Lonely_Adam05" });

        await giveTo("Lonely_Adam05");

        expect(holder()).toBe("member-3");
    });

    it("goes to nobody when a name matches two accounts and neither exactly", async () => {
        users.table.rows.push({ id: "member-3", username: "Lonely_Adam05" });

        const res = await giveTo("LONELY_ADAM05");

        expect(res.status).toBe(404);
        expect(holder()).toBe("member-1");
    });

    it("refuses the sender's own name in any case", async () => {
        const res = await giveTo("STEVE");

        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({ code: "chest_gift_to_self" });
    });
});
