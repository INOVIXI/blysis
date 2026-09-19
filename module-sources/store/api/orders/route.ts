import { NextRequest, NextResponse } from "next/server";
import { hasPermission, log, pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { ORDER_STATUSES } from "../../lib/order-status";

/**
 * Orders are listed here and made at `/store/checkout`.
 *
 * This file used to export a POST as well, described in the manifest as the
 * way an admin enters a manual order. It was not that. It had no admin check,
 * so any signed-in visitor could reach it; it computed its own subtotal and
 * its own coupon discount rather than calling `lib/pricing.ts`, so it never
 * got the rounding to whole cents the rest of the store does; it claimed a
 * use of a capped coupon before it created the order and outside any
 * transaction, so an order that failed to write still spent someone's coupon;
 * and it created the order and cleared the cart without a payment step of any
 * kind. Nothing called it. A second checkout that disagrees with the first is
 * worse than no second checkout.
 */

// GET /api/v1/store/orders - List orders
export async function GET(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const { page, limit, skip, take } = pageParams(searchParams, { defaultLimit: 10 });

        // Seeing everybody's orders is the job of serving them, which is not
        // the job of setting the prices. A member without it sees their own,
        // which is what this endpoint is for in the first place.
        const adminCheck = await hasPermission(session.user.id, "store.orders");

        const term = (searchParams.get("q") ?? "").trim();
        // The column is an enum, so a name that is not one of its members is
        // an error the database raises rather than an empty list. Anything
        // unrecognised means "no status filter".
        const asked = (searchParams.get("status") ?? "").trim().toUpperCase();
        const status = (ORDER_STATUSES as readonly string[]).includes(asked)
            ? (asked as (typeof ORDER_STATUSES)[number])
            : null;

        // Whoever serves orders sees all of them; a member sees their own
        const where = {
            ...(adminCheck ? {} : { userId: session.user.id }),
            ...(status ? { status } : {}),
            // An order number is what a buyer quotes in a ticket, and what
            // they bought is what they remember instead when they cannot find
            // the number. Both, or the box only answers half the questions
            // anybody brings to this screen.
            ...(term
                ? {
                      OR: [
                          { orderNumber: { contains: term, mode: "insensitive" as const } },
                          { items: { some: { name: { contains: term, mode: "insensitive" as const } } } },
                      ],
                  }
                : {}),
        };

        /*
         * How many orders are in each status, over the whole table.
         *
         * The screen used to count the ten rows it had and print that beside
         * each tab, so a shop with four hundred orders said "(2)" next to
         * Completed. The status filter itself is deliberately left out of the
         * scope below: the tabs have to keep saying what is in the other
         * statuses while one of them is selected, or picking a tab empties
         * every number but its own.
         */
        const { status: _ignored, ...countScope } = where;

        const [orders, total, byStatus] = await Promise.all([
            prisma.order.findMany({
                where,
                include: {
                    user: {
                        select: { id: true, username: true, email: true, avatar: true },
                    },
                    items: {
                        include: {
                            product: {
                                select: { id: true, name: true, slug: true, image: true },
                            },
                        },
                    },
                },
                skip,
                take,
                orderBy: { createdAt: "desc" },
            }),
            prisma.order.count({ where }),
            prisma.order.groupBy({ by: ["status"], where: countScope, _count: true }),
        ]);

        const counts: Record<string, number> = {};
        for (const row of byStatus) counts[row.status] = row._count;

        return NextResponse.json({
            orders,
            counts,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
    } catch (error) {
        log.error("List orders error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
