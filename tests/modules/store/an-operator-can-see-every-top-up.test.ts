// @vitest-environment node
/**
 * An operator can see every credit top-up a buyer started.
 *
 * A top-up is a payment like an order, and an operator could only find one in
 * the database. The list is for the store's managers only, and its status
 * filter has to tell a refunded top-up apart: its column still says
 * COMPLETED, because the payment did complete before the money went back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const session = { user: { id: "admin-1" } as { id: string } | undefined };
const hasPermission = vi.fn(async (_userId: string, _permission: string) => true);
const findMany = vi.fn(async (_args: { where: Record<string, unknown> }) => [] as unknown[]);
const count = vi.fn(async (_args: { where: Record<string, unknown> }) => 0);
const groupBy = vi.fn(async () => [{ provider: "paytr" }, { provider: "stripe" }]);

vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => (session.user ? session : null)) }));
vi.mock("@/core/sdk/server", async () => ({
    pageParams: (await import("@/core/lib/page-params")).pageParams,
    hasPermission,
    prisma: { creditTopUp: { findMany, count, groupBy } },
}));

const { GET } = await import("@/modules/store/api/admin/credit-top-ups/route");

const list = (query: string) => GET(new NextRequest(`http://site.test/api/v1/store/admin/credit-top-ups?${query}`));

beforeEach(() => {
    vi.clearAllMocks();
    session.user = { id: "admin-1" };
});

describe("the list of top-ups", () => {
    it("is for the store's managers only", async () => {
        session.user = undefined;
        expect((await list("")).status).toBe(401);
        session.user = { id: "member-1" };
        hasPermission.mockResolvedValueOnce(false);
        expect((await list("")).status).toBe(403);
        expect(findMany).not.toHaveBeenCalled();
    });

    it("tells a refunded top-up apart from one that was paid and kept", async () => {
        await list("status=refunded");
        expect(findMany.mock.calls[0][0].where).toEqual({ refundedAt: { not: null } });

        await list("status=COMPLETED");
        expect(findMany.mock.calls[1][0].where).toEqual({ status: "COMPLETED", refundedAt: null });
    });

    it("ignores a status that is not one rather than handing it to the database", async () => {
        await list("status=PAID;DROP");
        expect(findMany.mock.calls[0][0].where).toEqual({});
    });

    it("narrows by gateway and by buyer, and names the gateways for the filter", async () => {
        const res = await list("provider=stripe&q=steve&page=2");
        expect(findMany.mock.calls[0][0]).toMatchObject({
            where: { provider: "stripe", user: { username: { contains: "steve", mode: "insensitive" } } },
            skip: 25,
            take: 25,
        });
        await expect(res.json()).resolves.toMatchObject({ providers: ["paytr", "stripe"], page: 2 });
    });
});
