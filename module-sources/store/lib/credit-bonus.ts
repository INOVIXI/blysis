/**
 * A bonus on credit top-ups for a limited time, larger for a larger payment.
 *
 * An operator wants to say "this weekend, pay 250 or more and get 10% more
 * credits". A package's own bonus cannot say it: it is fixed, it has no end
 * date, and it does not apply to a top-up of a typed amount. A bonus campaign
 * is the missing noun. It has a start, an end and a list of tiers, and each
 * tier is a minimum payment and a percent.
 *
 * The rules, and why:
 *
 * - The tier is chosen by money paid, before the payment method's fee. The fee
 *   is the gateway's cost passed on, not a purchase.
 * - The percent is applied to the credits that were bought, never to a
 *   package's fixed bonus. A bonus on a bonus pays twice for one offer, and a
 *   package with a large fixed bonus would earn more than its price explains.
 * - The result is rounded down. Rounding up pays a credit on every small
 *   top-up, which is a thing somebody will farm.
 * - Only one campaign applies to one payment. When two run at the same time,
 *   the buyer gets the larger bonus for that payment: two offers on the page
 *   and the smaller one taken is a buyer who feels cheated.
 * - The bonus is decided when the payment starts and written on the top-up.
 *   A gateway can settle minutes or days later, and a campaign that ended in
 *   between must still pay what the buyer was shown. See
 *   `tests/modules/store/a-top-up-bonus-is-fixed-when-the-payment-starts.test.ts`.
 */
import { wallClockToInstant } from "@/core/sdk";

/** One step of a campaign: from this much money, this percent more credits. */
export interface BonusTier {
    /** Money paid, in the store currency, before the payment method's fee. */
    minAmount: number;
    /** Whole percent, 1 to `MAX_BONUS_PERCENT`. */
    percent: number;
}

/** A campaign as the store reads it. */
export interface BonusCampaign {
    id: string;
    name: string;
    startsAt: Date;
    endsAt: Date;
    isActive: boolean;
    tiers: BonusTier[];
}

/** What one payment earns from one campaign. */
export interface CampaignBonus {
    campaignId: string;
    name: string;
    percent: number;
    credits: number;
}

export const MAX_BONUS_TIERS = 10;
const MIN_BONUS_PERCENT = 1;
const MAX_BONUS_PERCENT = 500;

/**
 * The tiers as stored, made safe to read.
 *
 * The column is JSON, so a row written by hand or by an old version can hold
 * anything. A tier that is not a positive amount and a whole percent in range
 * is left out rather than paid.
 */
export function readTiers(raw: unknown): BonusTier[] {
    if (!Array.isArray(raw)) return [];
    const tiers: BonusTier[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const minAmount = Number((entry as { minAmount?: unknown }).minAmount);
        const percent = Number((entry as { percent?: unknown }).percent);
        if (!Number.isFinite(minAmount) || minAmount <= 0) continue;
        if (!Number.isInteger(percent) || percent < MIN_BONUS_PERCENT || percent > MAX_BONUS_PERCENT) continue;
        tiers.push({ minAmount, percent });
    }
    return tiers.sort((a, b) => a.minAmount - b.minAmount);
}

/** Whether the campaign applies at this instant. The end is not included. */
export function campaignRunning(campaign: Pick<BonusCampaign, "isActive" | "startsAt" | "endsAt">, at: Date): boolean {
    if (!campaign.isActive) return false;
    const now = at.getTime();
    return campaign.startsAt.getTime() <= now && now < campaign.endsAt.getTime();
}

/** The highest tier this payment reaches, or null when it reaches none. */
export function tierFor(tiers: readonly BonusTier[], paid: number): BonusTier | null {
    if (!Number.isFinite(paid) || paid <= 0) return null;
    let reached: BonusTier | null = null;
    for (const tier of readTiers(tiers)) {
        // Compared in cents, so 99.999 from a float does not miss a tier of 100.
        if (Math.round(paid * 100) >= Math.round(tier.minAmount * 100)) reached = tier;
    }
    return reached;
}

/** Bonus credits for a percent of the credits bought. Rounded down. */
export function bonusCreditsOf(baseCredits: number, percent: number): number {
    if (!Number.isFinite(baseCredits) || baseCredits <= 0) return 0;
    if (!Number.isFinite(percent) || percent <= 0) return 0;
    return Math.floor((Math.floor(baseCredits) * percent) / 100);
}

/**
 * The bonus one payment earns, from the campaign that gives it the most.
 *
 * `baseCredits` is the credits bought: a package's `credits` without its
 * fixed bonus, or the typed amount. A tie goes to the campaign that ends
 * first, and then to the lower id, so the same payment always names the same
 * campaign.
 */
export function bestBonus(
    campaigns: readonly BonusCampaign[],
    payment: { paid: number; baseCredits: number },
    at: Date,
): CampaignBonus | null {
    let best: (CampaignBonus & { endsAt: number }) | null = null;
    for (const campaign of campaigns) {
        if (!campaignRunning(campaign, at)) continue;
        const tier = tierFor(campaign.tiers, payment.paid);
        if (!tier) continue;
        const credits = bonusCreditsOf(payment.baseCredits, tier.percent);
        if (credits <= 0) continue;
        const candidate = { campaignId: campaign.id, name: campaign.name, percent: tier.percent, credits, endsAt: campaign.endsAt.getTime() };
        if (
            !best ||
            candidate.credits > best.credits ||
            (candidate.credits === best.credits && (candidate.endsAt < best.endsAt || (candidate.endsAt === best.endsAt && candidate.campaignId < best.campaignId)))
        ) {
            best = candidate;
        }
    }
    if (!best) return null;
    return { campaignId: best.campaignId, name: best.name, percent: best.percent, credits: best.credits };
}

/**
 * A date from the form as an instant.
 *
 * The form sends the wall clock, "2026-11-20T18:00", meaning that hour where
 * the shop is; an API caller may send an instant with its offset instead.
 * Both are accepted. Null when it is neither.
 */
export function campaignInstant(value: string, zone: string): Date | null {
    if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value)) {
        const at = new Date(value);
        return Number.isNaN(at.getTime()) ? null : at;
    }
    return wallClockToInstant(value, zone);
}

/** Why a campaign cannot be saved, as an error code, or null when it can. */
type CampaignProblem = "credit_bonus_dates" | "credit_bonus_tiers";

/**
 * Checks what a form cannot check on its own.
 *
 * The tiers must go up strictly: two tiers at one amount are two percents
 * with nothing to choose between them, and a higher tier with a lower percent
 * is a ladder where paying more gets less.
 */
export function campaignProblem(campaign: { startsAt: Date | null; endsAt: Date | null; tiers: readonly BonusTier[] }): CampaignProblem | null {
    const { startsAt, endsAt, tiers } = campaign;
    if (!startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return "credit_bonus_dates";
    if (endsAt.getTime() <= startsAt.getTime()) return "credit_bonus_dates";
    if (tiers.length === 0 || tiers.length > MAX_BONUS_TIERS) return "credit_bonus_tiers";
    for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i];
        if (!Number.isFinite(tier.minAmount) || tier.minAmount <= 0) return "credit_bonus_tiers";
        if (!Number.isInteger(tier.percent) || tier.percent < MIN_BONUS_PERCENT || tier.percent > MAX_BONUS_PERCENT) return "credit_bonus_tiers";
        if (i > 0) {
            const before = tiers[i - 1];
            if (tier.minAmount <= before.minAmount || tier.percent <= before.percent) return "credit_bonus_tiers";
        }
    }
    return null;
}

/**
 * The ids of the campaigns that run at the same time as another active one.
 *
 * Overlap is allowed, because the larger bonus wins for each payment, but an
 * operator who did not mean it should see it before the buyers do.
 */
export function overlapping(campaigns: readonly Pick<BonusCampaign, "id" | "isActive" | "startsAt" | "endsAt">[]): string[] {
    const active = campaigns.filter((campaign) => campaign.isActive);
    return active
        .filter((campaign) => active.some((other) =>
            other.id !== campaign.id &&
            other.startsAt.getTime() < campaign.endsAt.getTime() &&
            campaign.startsAt.getTime() < other.endsAt.getTime()))
        .map((campaign) => campaign.id);
}
