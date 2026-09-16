import { NextRequest, NextResponse } from "next/server";
import { hasPermission, log, pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

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

        // Whoever serves orders sees all of them; a member sees their own
        const where = adminCheck ? {} : { userId: session.user.id };

        const [orders, total] = await Promise.all([
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
        ]);

        return NextResponse.json({
            orders,
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
