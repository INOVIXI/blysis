// @vitest-environment node
/**
 * A server's scoreboard shows who topped up last, so the ranking hook answers
 * the newest top-ups as well as the biggest.
 *
 * Only a top-up counts: a gift, a refund or a prize is not somebody buying
 * credits. A member who bought twice is listed twice, because the list is of
 * top-ups and not of members.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const findMany = vi.fn();

vi.mock("@/core/sdk/server", () => ({
    prisma: { creditTransaction: { findMany }, user: { findMany: vi.fn() } },
}));

const { default: top } = await import("@/modules/credits/hooks/top");

beforeEach(() => {
    findMany.mockReset();
});

describe("the latest top-ups", () => {
    it("are asked newest first, top-ups only, and listed one row each", async () => {
        findMany.mockResolvedValue([
            { userId: "u2", amount: 50, user: { username: "alex" } },
            { userId: "u1", amount: 20, user: { username: "steve" } },
            { userId: "u2", amount: 10, user: { username: "alex" } },
        ]);

        const entries = await top([], { kind: "latest", period: "all", limit: 3 });

        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ type: "credit_purchase" }),
                orderBy: { createdAt: "desc" },
                take: 3,
            }),
        );
        expect(entries).toEqual([
            { rank: 1, userId: "u2", name: "alex", amount: 50 },
            { rank: 2, userId: "u1", name: "steve", amount: 20 },
            { rank: 3, userId: "u2", name: "alex", amount: 10 },
        ]);
    });

    it("start at the period's first day when a period is named", async () => {
        findMany.mockResolvedValue([]);

        await top([], { kind: "latest", period: "month", limit: 10 });

        const where = findMany.mock.calls[0][0].where;
        expect(where.createdAt.gte).toBeInstanceOf(Date);
        expect(where.createdAt.gte.getDate()).toBe(1);
    });

    it("skip a row whose member is gone", async () => {
        findMany.mockResolvedValue([{ userId: null, amount: 5, user: null }]);

        await expect(top([], { kind: "latest", period: "all", limit: 10 })).resolves.toEqual([]);
    });
});
