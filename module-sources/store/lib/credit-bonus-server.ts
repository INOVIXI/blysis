/**
 * The bonus campaigns running now, read from the database.
 *
 * Kept apart from `credit-bonus.ts` so the rules stay testable without a
 * database and the buyer's screen can import them.
 */
import type { Prisma } from "@prisma/client";
import { prisma, siteTimeZone } from "@/core/sdk/server";
import { campaignInstant, campaignProblem, campaignRunning, readTiers, type BonusCampaign } from "./credit-bonus";
import { creditBonusCampaignSchema } from "./validations";

/** The columns a campaign is read with, by the buyer's screen and the panel. */
export const CAMPAIGN_SELECT = {
    id: true,
    name: true,
    startsAt: true,
    endsAt: true,
    isActive: true,
    tiers: true,
} as const;

/** Every active campaign whose window holds this instant. */
export async function runningBonusCampaigns(at: Date): Promise<BonusCampaign[]> {
    const rows = await prisma.creditBonusCampaign.findMany({
        where: { isActive: true, startsAt: { lte: at }, endsAt: { gt: at } },
        select: CAMPAIGN_SELECT,
        orderBy: { endsAt: "asc" },
        // An operator writes these by hand; a few run at once at most.
        take: 20,
    });
    return rows
        .map((row) => ({ ...row, tiers: readTiers(row.tiers) }))
        .filter((campaign) => campaign.tiers.length > 0 && campaignRunning(campaign, at));
}

type CampaignWrite =
    | { ok: true; data: { name: string; startsAt: Date; endsAt: Date; isActive: boolean; tiers: Prisma.InputJsonValue } }
    | { ok: false; error: string; code?: string };

/**
 * A campaign from the form, checked and with its dates as instants.
 *
 * One function for create and edit, so the two cannot accept different
 * things. An edit sends the whole form, the same as a create.
 */
export async function campaignWrite(body: unknown): Promise<CampaignWrite> {
    const parsed = creditBonusCampaignSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const zone = await siteTimeZone();
    const startsAt = campaignInstant(parsed.data.startsAt, zone);
    const endsAt = campaignInstant(parsed.data.endsAt, zone);
    const tiers = parsed.data.tiers.map((tier) => ({ minAmount: Math.round(tier.minAmount * 100) / 100, percent: tier.percent }));
    const problem = campaignProblem({ startsAt, endsAt, tiers });
    if (problem === "credit_bonus_dates") return { ok: false, error: "The campaign must end after it starts", code: problem };
    if (problem === "credit_bonus_tiers") {
        return { ok: false, error: "Each tier must ask for more money and give a higher percent than the one before", code: problem };
    }
    return {
        ok: true,
        data: { name: parsed.data.name, startsAt: startsAt as Date, endsAt: endsAt as Date, isActive: parsed.data.isActive, tiers },
    };
}
