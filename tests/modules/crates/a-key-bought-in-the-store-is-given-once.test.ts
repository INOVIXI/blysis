// @vitest-environment node
/**
 * A key bought in the store is given once, and taken back once.
 *
 * The store announces a paid order every time a gateway retries its webhook
 * and every time a buyer reloads the page that settles it. Adding keys on each
 * announcement gives a buyer of one key as many keys as the gateway retried.
 * The receipt row per order line and crate is what stops it: only the call
 * that wrote the receipt adds keys. A refund is the same in reverse, and takes
 * back only what is still unspent.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { grantKeysForOrder, revokeKeysForOrder, type PaidOrder } from "@/modules/crates/lib/keys";

interface Grant { id: string; orderId: string; orderItemId: string; userId: string; crateId: string; quantity: number; revokedAt: Date | null }

const state = {
    crates: [] as { id: string; keyProductId: string | null }[],
    grants: [] as Grant[],
    rings: new Map<string, number>(),
};

const ringKey = (userId: string, crateId: string) => `${userId}:${crateId}`;

const tx = {
    crateKeyGrant: {
        createMany: async (args: { data: Omit<Grant, "id" | "revokedAt">[]; skipDuplicates: boolean }) => {
            let count = 0;
            for (const row of args.data) {
                if (state.grants.some((g) => g.orderItemId === row.orderItemId && g.crateId === row.crateId)) continue;
                state.grants.push({ ...row, id: `g${state.grants.length + 1}`, revokedAt: null });
                count += 1;
            }
            return { count };
        },
        updateMany: async (args: { where: { id: string; revokedAt: null } }) => {
            const grant = state.grants.find((g) => g.id === args.where.id && g.revokedAt === null);
            if (!grant) return { count: 0 };
            grant.revokedAt = new Date();
            return { count: 1 };
        },
    },
    crateKey: {
        upsert: async (args: { where: { userId_crateId: { userId: string; crateId: string } }; create: { count: number }; update: { count: { increment: number } } }) => {
            const key = ringKey(args.where.userId_crateId.userId, args.where.userId_crateId.crateId);
            state.rings.set(key, state.rings.has(key) ? state.rings.get(key)! + args.update.count.increment : args.create.count);
        },
        findUnique: async (args: { where: { userId_crateId: { userId: string; crateId: string } } }) => {
            const count = state.rings.get(ringKey(args.where.userId_crateId.userId, args.where.userId_crateId.crateId));
            return count === undefined ? null : { count };
        },
        updateMany: async (args: { where: { userId: string; crateId: string; count: { gte: number } }; data: { count: { decrement: number } } }) => {
            const key = ringKey(args.where.userId, args.where.crateId);
            const held = state.rings.get(key) ?? 0;
            if (held < args.where.count.gte) return { count: 0 };
            state.rings.set(key, held - args.data.count.decrement);
            return { count: 1 };
        },
    },
};

const db = {
    crateBox: {
        findMany: async (args: { where: { keyProductId: { in: string[] } } }) =>
            state.crates.filter((c) => c.keyProductId && args.where.keyProductId.in.includes(c.keyProductId)),
    },
    crateKeyGrant: {
        findMany: async (args: { where: { orderId: string } }) =>
            state.grants.filter((g) => g.orderId === args.where.orderId && g.revokedAt === null),
    },
    $transaction: async <T>(work: (t: never) => Promise<T>) => work(tx as never),
};

const ORDER: PaidOrder = {
    id: "order-1",
    userId: "u1",
    items: [
        { id: "line-1", productId: "legendary-key", quantity: 3 },
        { id: "line-2", productId: "a-rank", quantity: 1 },
    ],
};

beforeEach(() => {
    state.crates = [{ id: "legendary", keyProductId: "legendary-key" }, { id: "daily", keyProductId: null }];
    state.grants = [];
    state.rings = new Map();
});

describe("a paid order with a crate's key in it", () => {
    it("puts one key per unit on the buyer's ring", async () => {
        expect(await grantKeysForOrder(db as never, ORDER)).toBe(3);
        expect(state.rings.get("u1:legendary")).toBe(3);
    });

    it("gives nothing more when the same order is announced again", async () => {
        await grantKeysForOrder(db as never, ORDER);
        expect(await grantKeysForOrder(db as never, ORDER)).toBe(0);
        await Promise.all([grantKeysForOrder(db as never, ORDER), grantKeysForOrder(db as never, ORDER)]);

        expect(state.rings.get("u1:legendary")).toBe(3);
        expect(state.grants).toHaveLength(1);
    });

    it("adds to the keys already held from an earlier order", async () => {
        state.rings.set("u1:legendary", 2);
        await grantKeysForOrder(db as never, ORDER);
        expect(state.rings.get("u1:legendary")).toBe(5);
    });

    it("gives nothing for an order whose buyer has gone", async () => {
        expect(await grantKeysForOrder(db as never, { ...ORDER, userId: null })).toBe(0);
        expect(state.grants).toHaveLength(0);
    });
});

describe("a refunded order", () => {
    it("takes back the keys it bought, once", async () => {
        await grantKeysForOrder(db as never, ORDER);

        expect(await revokeKeysForOrder(db as never, ORDER)).toBe(3);
        expect(await revokeKeysForOrder(db as never, ORDER)).toBe(0);
        expect(state.rings.get("u1:legendary")).toBe(0);
    });

    it("takes back only what is still unspent, and leaves keys from other orders alone", async () => {
        await grantKeysForOrder(db as never, ORDER);
        // Two of the three were opened; one is left.
        state.rings.set("u1:legendary", 1);

        expect(await revokeKeysForOrder(db as never, ORDER)).toBe(1);
        expect(state.rings.get("u1:legendary")).toBe(0);
    });

    it("cannot be granted again by a late announcement once it was refunded", async () => {
        await grantKeysForOrder(db as never, ORDER);
        await revokeKeysForOrder(db as never, ORDER);

        expect(await grantKeysForOrder(db as never, ORDER)).toBe(0);
        expect(state.rings.get("u1:legendary")).toBe(0);
    });
});
