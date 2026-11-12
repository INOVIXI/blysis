import { NextRequest, NextResponse } from "next/server";
import { moduleSettings, prisma, rateLimitStrict, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { giftCodeRedeemSchema } from "../../../lib/validations";
import { applyFiltersAsync } from "@/core/sdk";

// POST /api/v1/gift-codes/redeem - Redeem a gift code
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // A gift code is a bearer secret worth credits, and the reply says
    // whether a guess exists. Without a ceiling, working through the code
    // space is only a matter of time.
    const rl = await rateLimitStrict(`gift-redeem:${session.user.id}`, {
        maxRequests: 10,
        windowMs: 15 * 60 * 1000,
    });
    if (!rl.success) {
        return NextResponse.json(
            { error: "Too many attempts. Try again later." },
            { status: 429 },
        );
    }

    const { enableGiftCards } = await moduleSettings<{ enableGiftCards: boolean }>("store");
    if (!enableGiftCards) {
        return NextResponse.json({ error: "Gift codes are not accepted" }, { status: 403 });
    }

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = giftCodeRedeemSchema.safeParse(jsonBody);
    if (!parsed.success) {
        return NextResponse.json({ error: "Code is required" }, { status: 400 });
    }
    const { code } = parsed.data;

    const giftCode = await prisma.giftCode.findUnique({
        where: { code: code.trim().toUpperCase() },
    });

    if (!giftCode) {
        return NextResponse.json({ error: "Invalid gift code" }, { status: 404 });
    }

    if (giftCode.isRedeemed) {
        return NextResponse.json({ error: "This code has already been redeemed" }, { status: 400 });
    }

    if (giftCode.expiresAt && giftCode.expiresAt < new Date()) {
        return NextResponse.json({ error: "This code has expired" }, { status: 400 });
    }

    const creditAmount = Number(giftCode.value);

    // The claim and the credit are one transaction: a credit that fails takes
    // the claim with it, so a code is never spent for nothing. The claim is
    // conditional on the code still being unredeemed, which is what stops two
    // requests from both redeeming it.
    const user = await prisma.$transaction(async (tx) => {
        const claimed = await tx.giftCode.updateMany({
            where: { id: giftCode.id, isRedeemed: false },
            data: { isRedeemed: true, redeemedAt: new Date(), redeemedById: session.user.id },
        });
        if (claimed.count === 0) return null;

        await applyFiltersAsync("credit.change", { applied: false }, {
            tx,
            userId: session.user.id as string,
            amount: creditAmount,
            type: "gift_redeem",
            description: `Redeemed gift code ${giftCode.code} for ${creditAmount} credits`,
        });
        return tx.user.findUniqueOrThrow({
            where: { id: session.user.id },
            select: { creditBalance: true },
        });
    });
    if (!user) {
        return NextResponse.json({ error: "This code has already been redeemed" }, { status: 400 });
    }

    return NextResponse.json({
        message: `Gift code redeemed! ${creditAmount.toFixed(2)} credits added to your balance.`,
        value: creditAmount,
        newBalance: Number(user.creditBalance),
    });
}
