/**
 * GET /api/v1/store/admin/coupon-uses - each customer's uses of each coupon (admin).
 *
 * One row per coupon and customer, newest use first, paged on the server: a
 * code handed to a whole community has a row for every member who used it.
 * Narrowed to one coupon with `coupon`, and to customers by name with `q`.
 *
 * Only orders placed since an order says which coupon it used are counted;
 * see migrations/023.
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { hasPermission, pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { foldUses, pairKey } from "../../../lib/coupon-uses";

/** `contains` for a raw ILIKE: the term's own wildcards match themselves. */
function likeTerm(term: string): string {
    return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = request.nextUrl.searchParams;
    const { page, limit, skip, take } = pageParams(params, { defaultLimit: 25 });
    const couponId = (params.get("coupon") ?? "").trim().slice(0, 64) || null;
    const term = (params.get("q") ?? "").trim().slice(0, 64);

    const where: Prisma.OrderWhereInput = {
        couponId: couponId ?? { not: null },
        ...(term ? { user: { username: { contains: term, mode: "insensitive" } } } : {}),
    };

    const [pairs, counted] = await Promise.all([
        prisma.order.groupBy({
            by: ["couponId", "userId"],
            where,
            _max: { createdAt: true },
            orderBy: { _max: { createdAt: "desc" } },
            skip,
            take,
        }),
        // How many coupon and customer pairs there are, without reading them
        // all: `groupBy` has no count of its groups.
        prisma.$queryRaw<{ total: bigint }[]>`
            SELECT COUNT(*)::bigint AS total FROM (
                SELECT 1 FROM "Order" o
                LEFT JOIN "User" u ON u.id = o."userId"
                WHERE o."couponId" IS NOT NULL
                ${couponId ? Prisma.sql`AND o."couponId" = ${couponId}` : Prisma.empty}
                ${term ? Prisma.sql`AND u.username ILIKE ${likeTerm(term)}` : Prisma.empty}
                GROUP BY o."couponId", o."userId"
            ) pairs`,
    ]);
    const total = Number(counted[0]?.total ?? 0);

    const onPage = pairs.filter((pair): pair is typeof pair & { couponId: string } => pair.couponId !== null);
    const [byStatus, coupons, users] = await Promise.all([
        onPage.length > 0
            ? prisma.order.groupBy({
                by: ["couponId", "userId", "status"],
                where: { OR: onPage.map((pair) => ({ couponId: pair.couponId, userId: pair.userId })) },
                _count: true,
            })
            : Promise.resolve([]),
        prisma.coupon.findMany({
            where: { id: { in: [...new Set(onPage.map((pair) => pair.couponId))] } },
            select: { id: true, code: true, perCustomerLimit: true },
        }),
        prisma.user.findMany({
            where: { id: { in: onPage.flatMap((pair) => (pair.userId ? [pair.userId] : [])) } },
            select: { id: true, username: true },
        }),
    ]);

    const uses = foldUses(byStatus);
    const couponOf = new Map(coupons.map((coupon) => [coupon.id, coupon]));
    const nameOf = new Map(users.map((user) => [user.id, user.username]));

    return NextResponse.json({
        uses: onPage.map((pair) => {
            const use = uses.get(pairKey(pair.couponId, pair.userId));
            const coupon = couponOf.get(pair.couponId);
            return {
                couponId: pair.couponId,
                // A coupon deleted since keeps its orders and loses its code.
                code: coupon?.code ?? null,
                perCustomerLimit: coupon?.perCustomerLimit ?? null,
                userId: pair.userId,
                username: pair.userId ? (nameOf.get(pair.userId) ?? null) : null,
                held: use?.held ?? 0,
                waiting: use?.waiting ?? 0,
                returned: use?.returned ?? 0,
                lastUsedAt: pair._max.createdAt,
            };
        }),
        page,
        limit,
        total,
    });
}
