// @vitest-environment node
/**
 * A call that moves money does it once, however often it is sent.
 *
 * A game server that timed out cannot tell a purchase that failed from one
 * whose answer was lost, so it sends the same request again with the same
 * key. The site keeps the first answer per server and key and gives it back,
 * and a request that arrives while the first is still running is told to
 * wait rather than running alongside it.
 *
 * A voucher is the same promise made with a reference instead of a key: the
 * item in game carries an id, copying the item copies the id, and the id pays
 * out once.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextResponse } from "next/server";
import { fakeTable, fakeTransaction } from "./fake-prisma";

const idempotency = fakeTable(() => ({ createdAt: new Date() }), "id", [["serverId", "key"]]);
const vouchers = fakeTable(() => ({ redeemedAt: null, redeemedById: null, createdAt: new Date() }));

/** The wallet: what each member holds, and every movement asked of it. */
const balances = new Map<string, number>();
const movements: { userId: string; amount: number; type: string }[] = [];

const client = { gameConnectIdempotency: idempotency, gameConnectVoucher: vouchers };
const prismaMock = { ...client, $transaction: fakeTransaction(client, [idempotency.table, vouchers.table]) };

vi.mock("@/core/sdk/server", () => ({
    prisma: prismaMock,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (hook: string, value: unknown, context: Record<string, unknown>) => {
        if (hook !== "credit.change") return value;
        const userId = context.userId as string;
        const amount = context.amount as number;
        const held = balances.get(userId) ?? 0;
        if (held + amount < 0) return { applied: false };
        balances.set(userId, held + amount);
        movements.push({ userId, amount, type: context.type as string });
        return { applied: true };
    }),
}));

const { onceFor } = await import("@/modules/game-connect/lib/idempotency");
const { createVoucher, mintVoucher, redeemVoucher } = await import("@/modules/game-connect/lib/vouchers");

beforeEach(() => {
    idempotency.table.rows = [];
    vouchers.table.rows = [];
    balances.clear();
    movements.length = 0;
});

describe("a request sent twice with one key", () => {
    it("does the work once and answers the retry with the first answer", async () => {
        const work = vi.fn(async () => NextResponse.json({ orderId: "o1" }, { status: 200 }));

        const first = await onceFor("s1", "k1", work);
        const second = await onceFor("s1", "k1", work);

        expect(work).toHaveBeenCalledTimes(1);
        expect(second.status).toBe(200);
        await expect(second.json()).resolves.toEqual(await first.json());
    });

    it("replays a refusal too, because a refusal is what happened", async () => {
        const work = vi.fn(async () => NextResponse.json({ error: "short", code: "insufficient_balance" }, { status: 402 }));

        await onceFor("s1", "k1", work);
        const again = await onceFor("s1", "k1", work);

        expect(work).toHaveBeenCalledTimes(1);
        expect(again.status).toBe(402);
    });

    it("tells a request that arrives while the first is running to wait", async () => {
        let release: () => void = () => undefined;
        const slow = vi.fn(
            () => new Promise<NextResponse>((resolve) => (release = () => resolve(NextResponse.json({ ok: true })))),
        );

        const first = onceFor("s1", "k1", slow);
        await Promise.resolve();
        const second = await onceFor("s1", "k1", slow);
        release();
        await first;

        expect(second.status).toBe(409);
        await expect(second.json()).resolves.toMatchObject({ code: "in_progress" });
        expect(slow).toHaveBeenCalledTimes(1);
    });

    it("frees the key when the work throws, so the retry runs it", async () => {
        await expect(onceFor("s1", "k1", async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
        const retry = await onceFor("s1", "k1", async () => NextResponse.json({ ok: true }));

        expect(retry.status).toBe(200);
    });

    it("frees the key when the site was not ready to answer", async () => {
        await onceFor("s1", "k1", async () => NextResponse.json({ error: "busy" }, { status: 503 }));
        const work = vi.fn(async () => NextResponse.json({ ok: true }));
        await onceFor("s1", "k1", work);

        expect(work).toHaveBeenCalledTimes(1);
    });

    it("keeps keys apart per server, so two servers cannot answer for each other", async () => {
        const work = vi.fn(async () => NextResponse.json({ ok: true }));

        await onceFor("s1", "k1", work);
        await onceFor("s2", "k1", work);

        expect(work).toHaveBeenCalledTimes(2);
    });
});

describe("a voucher", () => {
    it("is paid for when it is made, and not made when the balance is short", async () => {
        balances.set("u1", 40);

        await expect(createVoucher("u1", 50, "s1")).resolves.toEqual({ ok: false, code: "insufficient_balance" });
        expect(vouchers.table.rows).toHaveLength(0);

        const made = await createVoucher("u1", 30, "s1");
        expect(made.ok).toBe(true);
        expect(balances.get("u1")).toBe(10);
        expect(vouchers.table.rows).toHaveLength(1);
    });

    it("pays out once, however many times its id is handed in", async () => {
        const { voucherId } = await mintVoucher(25, "s1");

        const first = await redeemVoucher(voucherId, "u2");
        const second = await redeemVoucher(voucherId, "u3");

        expect(first).toEqual({ ok: true, amount: 25 });
        expect(second).toMatchObject({ ok: false, code: "voucher_used" });
        expect(movements.filter((m) => m.type === "voucher_redeem")).toEqual([{ userId: "u2", amount: 25, type: "voucher_redeem" }]);
    });

    it("pays out once when two redemptions race", async () => {
        const { voucherId } = await mintVoucher(25, "s1");

        const answers = await Promise.all([redeemVoucher(voucherId, "u2"), redeemVoucher(voucherId, "u3")]);

        expect(answers.filter((a) => a.ok)).toHaveLength(1);
        expect(movements.filter((m) => m.type === "voucher_redeem")).toHaveLength(1);
    });

    it("says an id it never issued was not found", async () => {
        await expect(redeemVoucher("gv_nothing", "u2")).resolves.toEqual({ ok: false, code: "not_found" });
    });
});
