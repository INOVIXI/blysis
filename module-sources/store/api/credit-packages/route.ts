import { NextRequest, NextResponse } from "next/server";
import { prisma, translateContent } from "@/core/sdk/server";
import { buyableNow } from "../../lib/credit-packages";
import { CREDIT_PACKAGE_TEXT, localeOf } from "../../lib/store-text";

/**
 * GET /api/v1/store/credit-packages - what a buyer may pick.
 *
 * Public and the same for everybody, so it may be kept for a moment. It says
 * what each package costs and what it gives, which is what the screen has to
 * draw; the bonus is shown separately because that is the reason to buy the
 * larger one. Named in `?locale=`, and in the original where the operator
 * wrote none; the address carries the language, so a cache keeps one each.
 */
export async function GET(request: NextRequest) {
    const found = await prisma.creditPackage.findMany({
        where: { isActive: true },
        orderBy: [{ order: "asc" }, { price: "asc" }],
        take: 50,
    });
    const packages = await translateContent(prisma, CREDIT_PACKAGE_TEXT, found, ["name"], localeOf(request));

    return NextResponse.json(
        {
            packages: packages.filter(buyableNow).map((pack) => ({
                id: pack.id,
                name: pack.name,
                credits: pack.credits,
                bonusCredits: pack.bonusCredits,
                price: Number(pack.price),
            })),
        },
        { headers: { "Cache-Control": "public, max-age=60" } },
    );
}
