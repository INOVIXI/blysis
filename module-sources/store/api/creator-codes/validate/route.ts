import { NextRequest, NextResponse } from "next/server";
import { getClientIP, prisma, rateLimitForRole, rateLimits } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { scopedSubtotal } from "../../../lib/pricing";

/**
 * GET /api/v1/store/creator-codes/validate?code=XXX
 *
 * The basket is read here rather than guessed at. A code may now be written
 * for one shelf, so "is this code any good" and "is this code any good to
 * you, with that in your basket" are different questions, and only the
 * second one is worth answering - a code that discounts nothing looks exactly
 * like a working code until the receipt.
 */
export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ip = getClientIP(request.headers);
    const rl = await rateLimitForRole(`creator-validate:${ip}`, rateLimits.auth, session.user.role);
    if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const code = request.nextUrl.searchParams.get("code");
    if (!code) return NextResponse.json({ valid: false });

    const creatorCode = await prisma.creatorCode.findUnique({
        where: { code: code.toUpperCase() },
        select: {
            code: true, discountPercent: true, isActive: true, productIds: true, categoryIds: true,
            creator: { select: { username: true } },
        },
    });

    // creator becomes null when the creator's user account is deleted
    // (SetNull cascade); treat that as an invalid code.
    if (!creatorCode || !creatorCode.isActive || !creatorCode.creator) {
        return NextResponse.json({ valid: false });
    }

    const cartItems = await prisma.cartItem.findMany({
        where: { userId: session.user.id },
        include: { product: { select: { id: true, price: true, categoryId: true } } },
    });
    const lines = cartItems.map((item) => ({
        productId: item.product.id,
        categoryId: item.product.categoryId ?? null,
        price: Number(item.product.price),
        quantity: item.quantity,
    }));
    const eligible = scopedSubtotal(
        creatorCode,
        lines,
        lines.map((line) => ({ id: line.productId, categoryId: line.categoryId })),
    );
    if (eligible <= 0) {
        return NextResponse.json({ valid: false, code: "creator_not_for_these_items" });
    }

    return NextResponse.json({
        valid: true,
        code: creatorCode.code,
        discountPercent: creatorCode.discountPercent,
        creator: creatorCode.creator.username,
        /** What it takes off this basket, so the page does not work it out. */
        discount: Math.round(eligible * (creatorCode.discountPercent / 100) * 100) / 100,
    });
}
