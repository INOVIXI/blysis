// @vitest-environment node
/**
 * A variant's commands are the shop's, wherever the buyer reads what they
 * bought.
 *
 * A line bought as a variant keeps a copy of it (`snapshotOf`), commands
 * included, so a later edit does not change what a paid order delivers. The
 * product page never sends them (`publicVariants`), but the buyer's own order
 * list, the order's page and the chest returned the copy whole: anybody who
 * bought a pack could read the console lines the server runs for it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const SECRET = "lp user {player} parent addtemp vip 180d";

const variant = {
    id: "six",
    label: "6 months",
    units: 1,
    durationDays: 180,
    commands: [{ command: SECRET, serverId: null, target: null, whenOnline: null }],
};

const line = {
    id: "line-1",
    productId: "prod-1",
    name: "VIP - 6 months",
    quantity: 1,
    price: 30,
    metadata: { type: "ONE_TIME", variables: {}, variant },
    product: { id: "prod-1", name: "VIP", slug: "vip", image: null },
};

const order = { id: "order-1", userId: "member-1", orderNumber: "B-1", items: [line], user: { id: "member-1", username: "steve" }, payments: [] };

let admin = false;

const db = {
    order: {
        findFirst: vi.fn(async () => ({ id: "order-1", userId: "member-1" })),
        findUnique: vi.fn(async () => order),
        findMany: vi.fn(async () => [order]),
        count: vi.fn(async () => 1),
        groupBy: vi.fn(async () => []),
    },
    chestItem: {
        findMany: vi.fn(async () => [
            {
                id: "chest-1",
                userId: "member-1",
                productId: "prod-1",
                productName: "VIP - 6 months",
                quantity: 1,
                variant,
                giftState: null,
                giftedById: null,
                isRedeemed: false,
                createdAt: new Date("2026-11-14T12:00:00Z"),
            },
        ]),
    },
    product: { findMany: vi.fn(async () => []) },
    user: { findUnique: vi.fn(async () => ({ receiveGifts: true })), findMany: vi.fn(async () => []) },
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    pageParams: () => ({ page: 1, limit: 10, skip: 0, take: 10 }),
    readJsonBody: vi.fn(),
    rateLimitForRole: vi.fn(async () => ({ success: true })),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    hasPermission: vi.fn(async () => admin),
    moduleSettings: vi.fn(async () => ({})),
}));
vi.mock("@/core/sdk/auth", () => ({
    auth: vi.fn(async () => ({ user: { id: "member-1", name: "steve", role: "member" } })),
}));
vi.mock("@/modules/store/lib/order-delivery", () => ({ deliveryOf: vi.fn(async () => ({})) }));
vi.mock("@/modules/store/lib/thank-you-coupon", () => ({ thankYouCouponsFor: vi.fn(async () => ({})) }));
vi.mock("@/modules/store/lib/fulfilment", () => ({ settleOrder: vi.fn(), voidOrder: vi.fn(), refundPayment: vi.fn() }));
vi.mock("@/modules/store/lib/gifts", () => ({ PENDING: "pending", setReceivesGifts: vi.fn(), sentGifts: vi.fn(async () => []), receivesGifts: vi.fn(async () => true) }));

const { GET: readOrder } = await import("@/modules/store/api/orders/[id]/route");
const { GET: listOrders } = await import("@/modules/store/api/orders/route");
const { GET: readChest } = await import("@/modules/store/api/chest/route");
// The chest route takes no request; it reads the signed-in member.

const request = (url: string) => {
    const req = new Request(url) as Request & { nextUrl: URL };
    req.nextUrl = new URL(url);
    return req as never;
};

beforeEach(() => {
    admin = false;
});

describe("a variant's commands", () => {
    it("are not on the buyer's own order", async () => {
        const res = await readOrder(request("http://localhost/api/v1/store/orders/order-1"), { params: Promise.resolve({ id: "order-1" }) });
        const text = await res.text();
        expect(res.status).toBe(200);
        expect(text).toContain("6 months");
        expect(text).not.toContain(SECRET);
    });

    it("are not in the buyer's order list", async () => {
        const res = await listOrders(request("http://localhost/api/v1/store/orders"));
        const text = await res.text();
        expect(res.status).toBe(200);
        expect(text).toContain("6 months");
        expect(text).not.toContain(SECRET);
    });

    it("are not in the buyer's chest", async () => {
        const res = await readChest();
        const text = await res.text();
        expect(res.status).toBe(200);
        expect(text).toContain("6 months");
        expect(text).not.toContain(SECRET);
    });

    it("stay on the order for staff who serve it", async () => {
        admin = true;
        const res = await readOrder(request("http://localhost/api/v1/store/orders/order-1"), { params: Promise.resolve({ id: "order-1" }) });
        expect(await res.text()).toContain(SECRET);
    });
});
