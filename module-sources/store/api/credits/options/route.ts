import { NextResponse } from "next/server";
import { moduleSettings } from "@/core/sdk/server";
import { readTopUpLimits, takesCents, type TopUpSettings } from "../../../lib/credit-top-up-quote";
import { runningBonusCampaigns } from "../../../lib/credit-bonus-server";

/**
 * GET /api/v1/store/credits/options - how this shop sells and spends credits.
 *
 * Public and the same for everybody: the top-up page draws its input, its
 * presets and its live preview from it, and every screen that shows a price
 * reads `creditsOnly` to decide whether that price is written as money or as
 * credits. None of it is secret; the checkout and the buy route enforce the
 * same settings on their own.
 *
 * The running bonus campaigns come with it, ends as instants, so the page
 * runs `quoteTopUp` itself on every keystroke with the same tiers the buy
 * route will use. The campaign's name is the operator's own note and is not
 * sent.
 */
export async function GET() {
    const settings = await moduleSettings<TopUpSettings & { creditsOnlyStore?: boolean }>("store");
    const limits = readTopUpLimits(settings);
    const campaigns = await runningBonusCampaigns(new Date());

    return NextResponse.json(
        {
            topUp: { ...limits, cents: takesCents(limits) },
            creditsOnly: settings.creditsOnlyStore === true,
            bonusCampaigns: campaigns.map((campaign) => ({
                id: campaign.id,
                endsAt: campaign.endsAt.toISOString(),
                tiers: campaign.tiers,
            })),
        },
        { headers: { "Cache-Control": "public, max-age=60" } },
    );
}
