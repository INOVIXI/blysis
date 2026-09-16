/**
 * A copy that arrives without the original's delivery is worse than no copy.
 *
 * The product row holds the price and the rules. What it does not hold is the
 * two things that make a purchase actually happen: the commands run on
 * delivery, and the fields a buyer fills in at checkout. Both live in their
 * own tables, keyed by product id, and a clone that only copies the row looks
 * complete on the admin screen and delivers nothing when somebody pays.
 *
 * Everything else keyed by product id is somebody's history - what they own,
 * what is in their basket, what they ordered, what is in their chest, which
 * campaign has them at a price. None of it is copied: a copy that starts life
 * owned by forty people is not a copy of a product, it is a gift.
 *
 * The whole thing is one transaction. A row written with no commands beside
 * it is exactly the half-made product this feature exists to prevent, and a
 * failure halfway through is the way to get one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Call { op: string; args: Record<string, unknown>; viaTx: boolean }
const calls: Call[] = [];

const db = {
    product: {
        findUnique: vi.fn(),
        findMany: vi.fn(async () => [] as { slug: string }[]),
        create: vi.fn(async () => ({ id: "prod-copy" })),
    },
    productCommand: { findMany: vi.fn(async () => [] as Record<string, unknown>[]), createMany: vi.fn(async () => ({ count: 0 })) },
    productVariable: { findMany: vi.fn(async () => [] as Record<string, unknown>[]), createMany: vi.fn(async () => ({ count: 0 })) },
    ownedProduct: { createMany: vi.fn(), findMany: vi.fn(async () => []) },
    cartItem: { createMany: vi.fn() },
    orderItem: { createMany: vi.fn() },
    chestItem: { createMany: vi.fn() },
    campaignEntry: { createMany: vi.fn() },
    subscription: { createMany: vi.fn() },
};

function trace<T extends object>(client: T, viaTx: boolean): T {
    return new Proxy(client, {
        get(model, modelName: string) {
            const delegate = (model as Record<string, unknown>)[modelName];
            if (typeof delegate !== "object" || delegate === null) return delegate;
            return new Proxy(delegate as object, {
                get(_, op: string) {
                    const fn = (delegate as Record<string, unknown>)[op];
                    if (typeof fn !== "function") return fn;
                    return (args: Record<string, unknown>) => {
                        calls.push({ op: `${modelName}.${op}`, args, viaTx });
                        return (fn as (a: unknown) => unknown)(args);
                    };
                },
            });
        },
    }) as T;
}

const prisma = {
    ...trace(db, false),
    $transaction: async (run: (tx: typeof db) => unknown) => run(trace(db, true)),
};

vi.mock("@/core/sdk/server", () => ({
    prisma,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    logActivity: vi.fn(async () => {}),
    isAdmin: vi.fn(async () => true),
    // Whoever stocks the shelf, which is what a copy is.
    hasPermission: vi.fn(async () => true),
    readJsonBody: vi.fn(async (request: Request) => request.json()),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "admin-1" } })) }));

const { POST } = await import("@/modules/store/api/admin/products/[id]/copy/route");

/** The product being copied, as the route reads it. */
function source(over: Record<string, unknown> = {}) {
    return {
        id: "prod-1",
        name: "VIP",
        slug: "vip",
        translations: null,
        description: null,
        shortDesc: null,
        price: "10.00",
        comparePrice: null,
        image: null,
        images: [],
        stock: null,
        type: "DIGITAL",
        deliveryData: null,
        subscriptionInterval: null,
        subscriptionIntervalCount: 1,
        availableFrom: null,
        availableUntil: null,
        availableDays: [],
        availableFromMinute: null,
        availableUntilMinute: null,
        outsideWindow: "countdown",
        roleIds: [],
        perPersonLimit: null,
        perPersonPeriod: "ever",
        periodStock: null,
        periodStockWindow: "day",
        durationDays: null,
        grantsRoleId: null,
        requiresProductIds: [],
        requiresAny: false,
        salePrice: null,
        saleFrom: null,
        saleUntil: null,
        categoryId: null,
        ...over,
    };
}

const ask = (body: Record<string, unknown> = {}) =>
    POST(
        new Request("http://localhost/api/v1/store/admin/products/prod-1/copy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }) as never,
        { params: Promise.resolve({ id: "prod-1" }) },
    );

beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    db.product.findUnique.mockResolvedValue(source());
    db.product.findMany.mockResolvedValue([]);
    db.product.create.mockResolvedValue({ id: "prod-copy", slug: "vip-copy" });
    db.productCommand.findMany.mockResolvedValue([]);
    db.productVariable.findMany.mockResolvedValue([]);
});

describe("copying a product", () => {
    it("answers with the copy", async () => {
        const res = await ask();
        expect(res.status).toBe(201);
        await expect(res.json()).resolves.toMatchObject({ product: { id: "prod-copy" } });
    });

    it("brings the delivery commands across, in their order", async () => {
        db.productCommand.findMany.mockResolvedValue([
            { id: "c1", productId: "prod-1", command: "lp user {player} parent add vip", serverId: "srv-1", order: 0 },
            { id: "c2", productId: "prod-1", command: "broadcast {player} is VIP", serverId: null, order: 1 },
        ]);

        await ask();

        expect(db.productCommand.createMany).toHaveBeenCalledTimes(1);
        const written = db.productCommand.createMany.mock.calls[0][0] as { data: Record<string, unknown>[] };
        expect(written.data).toEqual([
            { productId: "prod-copy", command: "lp user {player} parent add vip", serverId: "srv-1", order: 0 },
            { productId: "prod-copy", command: "broadcast {player} is VIP", serverId: null, order: 1 },
        ]);
    });

    it("brings the buyer's fields across", async () => {
        db.productVariable.findMany.mockResolvedValue([
            { id: "v1", productId: "prod-1", name: "player", label: "Player name", type: "text", required: true, placeholder: "Your name", options: null },
        ]);

        await ask();

        const written = db.productVariable.createMany.mock.calls[0][0] as { data: Record<string, unknown>[] };
        expect(written.data).toEqual([
            { productId: "prod-copy", name: "player", label: "Player name", type: "text", required: true, placeholder: "Your name", options: null },
        ]);
    });

    it("writes nothing extra when the original had none", async () => {
        await ask();
        expect(db.productCommand.createMany).not.toHaveBeenCalled();
        expect(db.productVariable.createMany).not.toHaveBeenCalled();
    });

    it("copies nobody's history", async () => {
        await ask();
        for (const model of ["ownedProduct", "cartItem", "orderItem", "chestItem", "campaignEntry", "subscription"] as const) {
            expect(db[model].createMany).not.toHaveBeenCalled();
        }
    });

    it("writes the row and its children in one transaction", async () => {
        db.productCommand.findMany.mockResolvedValue([
            { id: "c1", productId: "prod-1", command: "say hello", serverId: null, order: 0 },
        ]);
        await ask();
        expect(calls.find((c) => c.op === "product.create")?.viaTx).toBe(true);
        expect(calls.find((c) => c.op === "productCommand.createMany")?.viaTx).toBe(true);
    });

    it("gives the copy a free slug", async () => {
        db.product.findMany.mockResolvedValue([{ slug: "vip-copy" }, { slug: "vip-copy-2" }]);
        await ask();
        const written = db.product.create.mock.calls[0][0] as { data: { slug: string } };
        expect(written.data.slug).toBe("vip-copy-3");
    });

    it("takes the name it was given", async () => {
        await ask({ name: "VIP (kopya)" });
        const written = db.product.create.mock.calls[0][0] as { data: { name: string } };
        expect(written.data.name).toBe("VIP (kopya)");
    });

    it("keeps the original's name when it was given none", async () => {
        await ask();
        const written = db.product.create.mock.calls[0][0] as { data: { name: string } };
        expect(written.data.name).toBe("VIP");
    });

    it("says so when there is nothing to copy", async () => {
        db.product.findUnique.mockResolvedValue(null);
        const res = await ask();
        expect(res.status).toBe(404);
        expect(db.product.create).not.toHaveBeenCalled();
    });
});
