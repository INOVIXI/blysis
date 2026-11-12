// @vitest-environment node
/**
 * A gift code is spent in the same transaction that pays its credits.
 *
 * The route marked the code redeemed with one write and credited the member
 * with a second, separate one. When the credit failed, the code stayed
 * redeemed and the member received nothing: a code worth credits was gone for
 * both of them. The claim now runs on the transaction with the credit, so a
 * failed credit takes the claim with it, and a claim that lost the race
 * credits nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

interface CodeRow {
    id: string;
    code: string;
    value: number;
    isRedeemed: boolean;
    redeemedAt: Date | null;
    redeemedById: string | null;
    expiresAt: Date | null;
}

const fresh = (): CodeRow => ({
    id: "gift-1",
    code: "ABCD-1234",
    value: 250,
    isRedeemed: false,
    redeemedAt: null,
    redeemedById: null,
    expiresAt: null,
});

let row: CodeRow = fresh();
let balance = 100;
let creditFails = false;

/** The writes the claim makes, on `prisma` and on a transaction alike. */
const giftCode = {
    findUnique: vi.fn(async () => ({ ...row })),
    updateMany: vi.fn(async (args: { where: { id: string; isRedeemed: boolean }; data: Partial<CodeRow> }) => {
        if (row.id !== args.where.id || row.isRedeemed !== args.where.isRedeemed) return { count: 0 };
        Object.assign(row, args.data);
        return { count: 1 };
    }),
};

const user = {
    findUniqueOrThrow: vi.fn(async () => ({ creditBalance: balance })),
};

/** A transaction that puts the rows back when its body throws. */
const prisma = {
    giftCode,
    $transaction: vi.fn(async (body: (tx: { giftCode: typeof giftCode; user: typeof user }) => unknown) => {
        const before = { row: { ...row }, balance };
        try {
            return await body({ giftCode, user });
        } catch (err) {
            row = before.row;
            balance = before.balance;
            throw err;
        }
    }),
};

vi.mock("@/core/sdk/server", () => ({
    prisma,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    moduleSettings: vi.fn(async () => ({ enableGiftCards: true })),
    rateLimitStrict: vi.fn(async () => ({ success: true })),
    readJsonBody: vi.fn(async (request: Request) => request.json()),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "user-1", role: "member" } })) }));
vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (_hook: string, value: unknown, ctx: { amount: number }) => {
        if (creditFails) throw new Error("the wallet is down");
        balance += ctx.amount;
        return { ...(value as object), applied: true };
    }),
}));

const { POST } = await import("@/modules/store/api/gift-codes/redeem/route");

function redeem() {
    return POST(
        new NextRequest("https://shop.example/api/v1/store/gift-codes/redeem", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code: "abcd-1234" }),
        }),
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    row = fresh();
    balance = 100;
    creditFails = false;
});

describe("redeeming a gift code", () => {
    it("marks the code redeemed and credits its value", async () => {
        const res = await redeem();

        expect(res.status).toBe(200);
        expect(row.isRedeemed).toBe(true);
        expect(row.redeemedById).toBe("user-1");
        expect(balance).toBe(350);
    });

    it("leaves the code unredeemed when the credit fails", async () => {
        creditFails = true;

        await expect(redeem()).rejects.toThrow("the wallet is down");

        expect(row.isRedeemed).toBe(false);
        expect(row.redeemedById).toBeNull();
        expect(balance).toBe(100);
    });

    it("lets the member try again once the credit works", async () => {
        creditFails = true;
        await expect(redeem()).rejects.toThrow();
        creditFails = false;

        const res = await redeem();

        expect(res.status).toBe(200);
        expect(balance).toBe(350);
    });

    it("claims the code on the transaction that credits it", async () => {
        await redeem();

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(giftCode.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
            giftCode.updateMany.mock.invocationCallOrder[0],
        );
    });

    it("credits nothing when somebody else claimed the code first", async () => {
        // Both requests read the code unredeemed; the other one wins the write.
        giftCode.findUnique.mockImplementationOnce(async () => {
            const seen = { ...row };
            row.isRedeemed = true;
            row.redeemedById = "user-2";
            return seen;
        });

        const res = await redeem();

        expect(res.status).toBe(400);
        expect(balance).toBe(100);
        expect(row.redeemedById).toBe("user-2");
    });

    it("answers a code that is already redeemed without crediting it", async () => {
        row.isRedeemed = true;

        const res = await redeem();

        expect(res.status).toBe(400);
        expect(balance).toBe(100);
    });
});
