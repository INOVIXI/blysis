import { NextRequest, NextResponse } from "next/server";
import { prisma, translateContent } from "@/core/sdk/server";
import { buyableNow } from "../../lib/credit-packages";
import { CREDIT_PACKAGE_TEXT, localeOf } from "../../lib/store-text";
import { bestBonus, type CampaignBonus } from "../../lib/credit-bonus";
import { runningBonusCampaigns } from "../../lib/credit-bonus-server";

/**
 * GET /api/v1/store/credit-packages - what a buyer may pick.
 *
 * Public and the same for everybody, so it may be kept for a moment. It says
 * what each package costs and what it gives, which is what the screen has to
 * draw; the bonus is shown separately because that is the reason to buy the
 * larger one. Named in `?locale=`, and in the original where the operator
 * wrote none; the address carries the language, so a cache keeps one each.
 *
 * A running bonus campaign comes with it: its tiers and its end as an
 * instant, so the screen counts down on its own clock rather than showing a
 * duration a cache kept for a minute. Each package says what the campaign
 * adds to it, worked out by the same function the purchase uses. The
 * campaign's name is the operator's own note and is not sent.
 */
function publicBonus(bonus: CampaignBonus | null): { percent: number; credits: number } | null {
    return bonus ? { percent: bonus.percent, credits: bonus.credits } : null;
}

export async function GET(request: NextRequest) {
    const found = await prisma.creditPackage.findMany({
        where: { isActive: true },
        orderBy: [{ order: "asc" }, { price: "asc" }],
        take: 50,
    });
    const packages = await translateContent(prisma, CREDIT_PACKAGE_TEXT, found, ["name"], localeOf(request));
    const now = new Date();
    const campaigns = await runningBonusCampaigns(now);

    return NextResponse.json(
        {
            packages: packages.filter(buyableNow).map((pack) => ({
                id: pack.id,
                name: pack.name,
                credits: pack.credits,
                bonusCredits: pack.bonusCredits,
                price: Number(pack.price),
                campaignBonus: publicBonus(bestBonus(campaigns, { paid: Number(pack.price), baseCredits: pack.credits }, now)),
            })),
            bonusCampaigns: campaigns.map((campaign) => ({
                id: campaign.id,
                endsAt: campaign.endsAt.toISOString(),
                tiers: campaign.tiers,
            })),
        },
        { headers: { "Cache-Control": "public, max-age=60" } },
    );
}
