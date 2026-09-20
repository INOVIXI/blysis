import { NextRequest, NextResponse } from "next/server";
import { log, moduleSettings, prisma, rateLimitForRoleAsync, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { availabilityFor, type ProductRow } from "../../lib/availability-server";
import { priceCartLines } from "../../lib/cart-pricing";
import { creditingPurchases, ownedRungsOn } from "../../lib/upgrade-credit-server";
import { z } from "zod";

const cartItemSchema = z.object({
    productId: z.string(),
    quantity: z.number().int().min(0).max(99),
});

// GET /api/v1/store/cart - Get user's cart
export async function GET() {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const cartItems = await prisma.cartItem.findMany({
            where: { userId: session.user.id },
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        price: true,
                        comparePrice: true,
                        image: true,
                        stock: true,
                        isActive: true,
                        categoryId: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        // What this buyer pays, not what the products cost.
        //
        // The cart summed list prices while the checkout charged the upgrade
        // price, so somebody upgrading a rank read one number on the cart page
        // and was taken a smaller one a click later. A cart that disagrees with
        // the till is a cart nobody can trust in either direction.
        const ownedIds = await creditingPurchases(session.user.id);
        const basket = cartItems.map((item) => ({
            productId: item.product.id,
            categoryId: (item.product as unknown as { categoryId: string | null }).categoryId ?? null,
            price: Number(item.product.price),
            quantity: item.quantity,
        }));
        // The arithmetic lives in `cart-pricing.ts` because the coupon
        // preview has to reach the same number, and reaching it separately is
        // how the two came to disagree. The rungs come from the shelf rather
        // than the basket: what somebody owns is what they did not put in it.
        const { lines, subtotal: total } = priceCartLines(
            basket,
            ownedIds,
            await ownedRungsOn(basket.map((line) => line.categoryId), ownedIds),
        );
        const byProduct = new Map(lines.map((line) => [line.productId, line]));
        const priced = cartItems.map((item) => ({
            ...item,
            upgradeCredit: byProduct.get(item.product.id)?.upgradeCredit ?? 0,
            payPrice: byProduct.get(item.product.id)?.payPrice ?? Number(item.product.price),
        }));

        return NextResponse.json({
            items: priced,
            itemCount: priced.length,
            total,
        });
    } catch (error) {
        log.error("Get cart error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

// POST /api/v1/store/cart - Add item to cart
export async function POST(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const allowed = await rateLimitForRoleAsync(
            `cart-write:${session.user.id}`,
            { maxRequests: 60, windowMs: 60_000 },
            session.user.role
        );
        if (!allowed) {
            return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });
        }

        const body = await readJsonBody(request);
        if (body instanceof NextResponse) return body;
        const validation = cartItemSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { error: validation.error.issues[0].message },
                { status: 400 }
            );
        }

        const { productId, quantity } = validation.data;

        // quantity=0 means remove item from cart
        if (quantity === 0) {
            await prisma.cartItem.deleteMany({
                where: {
                    userId: session.user.id,
                    productId,
                },
            });
            return NextResponse.json({ message: "Item removed from cart" });
        }

        // Check if product exists and is active
        const product = await prisma.product.findUnique({
            where: { id: productId },
        });

        if (!product || !product.isActive) {
            return NextResponse.json(
                { error: "Product not found or unavailable" },
                { status: 404 }
            );
        }

        // Check stock
        if (product.stock !== null && product.stock < quantity) {
            return NextResponse.json(
                { error: "Insufficient stock" },
                { status: 400 }
            );
        }

        // The window, the per-person limit and today's allowance. Asked here
        // as a courtesy so a shopper is told at the moment they add rather
        // than at the till; the checkout asks again, because that is where it
        // has to be true.
        const state = await availabilityFor(prisma, product as unknown as ProductRow, session.user.id);
        if (!state.buyable) {
            return NextResponse.json(
                { error: state.state, code: `store_${state.state}`, opensAt: state.opensAt },
                { status: 409 },
            );
        }
        if (state.remainingForPerson !== null && quantity > state.remainingForPerson) {
            return NextResponse.json(
                {
                    error: "limit_reached",
                    code: "store_limit_reached",
                    remaining: state.remainingForPerson,
                },
                { status: 409 },
            );
        }

        // A cart could hold every product in the catalogue: nothing capped how
        // many distinct lines it carried, only the quantity on each. The cap
        // applies to new lines only, so raising the quantity on something
        // already in the cart is never refused.
        const { maxCartItems } = await moduleSettings<{ maxCartItems: number }>("store");
        const existing = await prisma.cartItem.findUnique({
            where: { userId_productId: { userId: session.user.id, productId } },
            select: { id: true },
        });
        if (!existing) {
            const lines = await prisma.cartItem.count({ where: { userId: session.user.id } });
            if (lines >= maxCartItems) {
                return NextResponse.json(
                    { error: `A cart can hold at most ${maxCartItems} different products`, code: "cart_full" },
                    { status: 400 },
                );
            }
        }

        // Upsert cart item
        const cartItem = await prisma.cartItem.upsert({
            where: {
                userId_productId: {
                    userId: session.user.id,
                    productId,
                },
            },
            update: { quantity },
            create: {
                userId: session.user.id,
                productId,
                quantity,
            },
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        price: true,
                        image: true,
                    },
                },
            },
        });

        return NextResponse.json({ cartItem }, { status: 201 });
    } catch (error) {
        log.error("Add to cart error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

// DELETE /api/v1/store/cart - Clear cart
export async function DELETE() {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const allowed = await rateLimitForRoleAsync(
            `cart-write:${session.user.id}`,
            { maxRequests: 60, windowMs: 60_000 },
            session.user.role
        );
        if (!allowed) {
            return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });
        }

        await prisma.cartItem.deleteMany({
            where: { userId: session.user.id },
        });

        return NextResponse.json({ message: "Cart cleared" });
    } catch (error) {
        log.error("Clear cart error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
