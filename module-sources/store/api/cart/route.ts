import { NextRequest, NextResponse } from "next/server";
import { log, moduleSettings, prisma, rateLimitForRoleAsync, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { availabilityFor, type ProductRow } from "../../lib/availability-server";
import { priceCartLines } from "../../lib/cart-pricing";
import { saleAdjustedPrice } from "../../lib/store-sale-server";
import { creditingPurchases, ownedRungsOn } from "../../lib/upgrade-credit-server";
import { localeOf, productsIn } from "../../lib/store-text";
import { basketLinePrice, chosenVariant, offeredVariants, unitsDelivered } from "../../lib/variants";
import { textFor } from "@/core/sdk";
import { z } from "zod";

const cartItemSchema = z.object({
    productId: z.string(),
    quantity: z.number().int().min(0).max(99),
    /** The variant chosen, for a product sold in variants. */
    variantId: z.string().max(64).nullish(),
});

// GET /api/v1/store/cart - Get user's cart, its products named in `?locale=`
export async function GET(request: NextRequest) {
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
                        salePrice: true,
                        saleFrom: true,
                        saleUntil: true,
                        variants: true,
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
        // The price the checkout starts from, sale window and store-wide sale
        // included, rather than the column: a cart that quoted the list price
        // during a sale read higher than the till.
        const listedAt = await saleAdjustedPrice(new Date());
        const locale = localeOf(request);
        // A line's variant, read from the product now. One the operator took
        // away is none, and the line says so rather than falling back to the
        // product's own price: the checkout refuses it the same way.
        const variantOf = (item: (typeof cartItems)[number]) =>
            item.variantId ? (offeredVariants(item.product.variants).find((v) => v.id === item.variantId) ?? null) : null;
        const priceOf = (item: (typeof cartItems)[number]) =>
            basketLinePrice(item.product, item.variantId, listedAt(item.product));
        const basket = cartItems.map((item) => ({
            productId: item.product.id,
            categoryId: item.product.categoryId ?? null,
            price: priceOf(item),
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
        const named = new Map((await productsIn(cartItems.map((item) => item.product), locale)).map((p) => [p.id, p]));
        const priced = cartItems.map((item) => {
            const variant = variantOf(item);
            const { variants: _variants, ...product } = named.get(item.product.id) ?? item.product;
            return {
                ...item,
                product,
                variant: variant ? { id: variant.id, label: textFor(variant.label, locale), units: variant.units } : null,
                // A product that sells only in variants, with none on the line
                // any more, cannot be checked out as it is.
                needsVariant: offeredVariants(item.product.variants).length > 0 && !variant,
                upgradeCredit: byProduct.get(item.product.id)?.upgradeCredit ?? 0,
                payPrice: byProduct.get(item.product.id)?.payPrice ?? priceOf(item),
            };
        });

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

        const { productId, quantity, variantId } = validation.data;

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

        // A product sold in variants goes into the basket as one of them.
        const choice = chosenVariant(product.variants, variantId);
        if (!choice.ok) {
            return NextResponse.json({ error: choice.code, code: choice.code }, { status: 400 });
        }

        // Check stock, in the units the variant delivers.
        const units = unitsDelivered(quantity, choice.variant);
        if (product.stock !== null && product.stock < units) {
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
            update: { quantity, variantId: choice.variant?.id ?? null },
            create: {
                userId: session.user.id,
                productId,
                quantity,
                variantId: choice.variant?.id ?? null,
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
