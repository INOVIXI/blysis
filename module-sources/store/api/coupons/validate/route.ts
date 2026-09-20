import { NextRequest, NextResponse } from "next/server";
import { moduleSettings, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { couponValidateSchema } from "../../../lib/validations";
import { computeCouponDiscount, scopedSubtotal } from "../../../lib/pricing";

// POST /api/v1/store/coupons/validate - Check coupon validity
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await rateLimitForRole(
        `coupon:${session.user.id}`,
        { maxRequests: 10, windowMs: 60_000 },
        session.user.role
    );
    if (!rl.success) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const { enableCoupons } = await moduleSettings<{ enableCoupons: boolean }>("store");
    if (!enableCoupons) {
        return NextResponse.json({ valid: false, code: "coupons_off" });
    }

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = couponValidateSchema.safeParse(jsonBody);
    if (!parsed.success) return NextResponse.json({ error: "Code required" }, { status: 400 });
    const { code } = parsed.data;

    const coupon = await prisma.coupon.findUnique({
        where: { code: code.toUpperCase() },
    });
    if (!coupon) {
        return NextResponse.json({ valid: false, code: "coupon_unknown" });
    }

    /*
     * The basket is read here rather than taken from the request.
     *
     * The browser used to send what it thought the cart was worth, and the
     * answer - including whether a minimum purchase had been met - was
     * computed from it. It also cannot say which products are in the basket,
     * which is what a coupon scoped to a shelf has to know.
     */
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
    const cartSubtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);

    // The same function the checkout charges by.
    //
    // This route used to repeat the rules, and had drifted on one of them: a
    // fixed-value coupon was previewed at its full face value while the
    // checkout caps it at the subtotal, so a 50 coupon on a 10 cart promised
    // a shopper 50 off and then took 10. A preview that disagrees with the
    // till is worse than no preview.
    const eligible = scopedSubtotal(
        coupon,
        lines,
        lines.map((line) => ({ id: line.productId, categoryId: line.categoryId })),
    );
    const priced = computeCouponDiscount(coupon, cartSubtotal, new Date(), eligible);

    if (priced.code) {
        /*
         * Why a coupon failed is deliberately not spelled out: one that never
         * existed and one that has run out answer the same, so the response
         * cannot be used to go looking for codes. Two are exceptions, because
         * they are the two a shopper can act on - spend more, or put
         * something the offer covers in the basket.
         */
        const tellable = priced.code === "coupon_min_purchase" || priced.code === "coupon_not_for_these_items";
        return NextResponse.json({
            valid: false,
            code: tellable ? priced.code : "coupon_unknown",
            ...(priced.code === "coupon_min_purchase" ? { minPurchase: Number(coupon.minPurchase) } : {}),
        });
    }

    return NextResponse.json({
        valid: true,
        coupon: {
            code: coupon.code,
            type: coupon.type,
            value: Number(coupon.value),
            discount: priced.discount,
        },
    });
}
