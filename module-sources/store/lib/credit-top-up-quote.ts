/**
 * What a top-up of a typed amount costs and earns, and whether it is allowed.
 *
 * The buyer's screen and `POST /store/credits/buy` both answer from here. The
 * screen runs it on every keystroke to say "you pay X, you get N credits and
 * B bonus", and the route runs it again on what the buyer sent, so the number
 * the screen promised is the number the gateway is asked for and the bonus
 * written on the top-up. Two copies of this arithmetic drifted once already:
 * the screen offered nothing and the route had its own limits in credits with
 * an English "$0.50" in them. See
 * `tests/modules/store/a-typed-top-up-is-quoted-once.test.ts`.
 *
 * The buyer types money, in the site currency, because that is what they
 * think in. The route takes whole credits, because a credit is what the
 * ledger holds. Money becomes credits rounded down and the credits are priced
 * back, so at a price such as 0.013 a credit the buyer pays slightly less than
 * they typed rather than a fraction of a credit being paid for and not given.
 *
 * Client-safe: nothing here touches the database.
 */
import { bestBonus, readTiers, campaignRunning, type BonusCampaign, type CampaignBonus } from "./credit-bonus";

/** The operator's settings for typed top-ups, made safe to compute with. */
export interface TopUpLimits {
    /** What one credit costs in the site currency. */
    pricePerUnit: number;
    /** The least a typed top-up may charge, in the site currency. */
    min: number;
    /** The most a typed top-up may charge, in the site currency. */
    max: number;
    /** Amounts offered as one-press choices, in the site currency. */
    presets: number[];
    /** Whether the buyer may type an amount, or only press a preset. */
    typed: boolean;
}

/**
 * The smallest charge any top-up may make. Card gateways refuse a charge
 * below about half a unit of most currencies, and finding that out on the
 * gateway's page is a failed payment the buyer has to start again. The min
 * setting cannot go below it either: see its bound in the manifest.
 */
export const MIN_CHARGE = 0.5;

const DEFAULT_LIMITS: TopUpLimits = { pricePerUnit: 0.01, min: 1, max: 10000, presets: [], typed: true };
const MAX_PRESETS = 8;

/**
 * The store settings this file reads, as `moduleSettings("store")` returns
 * them. A type rather than an interface, because `moduleSettings` asks for a
 * record and only a type literal is one. Each value is still checked below:
 * a test, or a row written by an old version, may leave one out.
 */
export type TopUpSettings = {
    creditsPricePerUnit?: number;
    creditsTopUpMin?: number;
    creditsTopUpMax?: number;
    creditsTopUpPresets?: string;
    creditsTopUpTyped?: boolean;
};

function positive(value: unknown, fallback: number): number {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** Money as a whole number of cents, so 0.1 + 0.2 is never 0.30000000000000004. */
function cents(amount: number): number {
    return Math.round(amount * 100);
}

/**
 * The preset list an operator typed, as amounts.
 *
 * It is one text setting, "50, 100, 250", because a setting has no list type.
 * What is not a number, or falls outside the limits, is left out rather than
 * offered and then refused.
 */
export function readPresets(text: unknown, min: number, max: number): number[] {
    if (typeof text !== "string") return [];
    const amounts = new Set<number>();
    for (const part of text.split(/[\s,;]+/)) {
        if (part === "") continue;
        const amount = Number(part);
        if (!Number.isFinite(amount)) continue;
        const rounded = cents(amount) / 100;
        if (cents(rounded) < cents(min) || cents(rounded) > cents(max)) continue;
        amounts.add(rounded);
    }
    return [...amounts].sort((a, b) => a - b).slice(0, MAX_PRESETS);
}

/** The settings as limits, with the manifest's defaults where one is missing. */
export function readTopUpLimits(settings: TopUpSettings): TopUpLimits {
    const pricePerUnit = positive(settings.creditsPricePerUnit, DEFAULT_LIMITS.pricePerUnit);
    const min = Math.max(MIN_CHARGE, positive(settings.creditsTopUpMin, DEFAULT_LIMITS.min));
    // A max below the min is an operator's typo, and honouring it would refuse
    // every amount. The min wins and the range is one amount wide.
    const max = Math.max(min, positive(settings.creditsTopUpMax, DEFAULT_LIMITS.max));
    return {
        pricePerUnit,
        min,
        max,
        presets: readPresets(settings.creditsTopUpPresets, min, max),
        typed: settings.creditsTopUpTyped !== false,
    };
}

/**
 * Whether the buyer types whole units or may type cents. At a whole price per
 * credit, a cent buys nothing; at 0.01 or 0.013 it does.
 */
export function takesCents(limits: Pick<TopUpLimits, "pricePerUnit">): boolean {
    return !Number.isInteger(limits.pricePerUnit);
}

/** The whole credits an amount of money buys, rounded down. */
export function creditsFor(money: number, pricePerUnit: number): number {
    if (!Number.isFinite(money) || money <= 0 || !(pricePerUnit > 0)) return 0;
    // In cents, with a nudge for the float: 10 / 0.01 is 999.9999999999999.
    return Math.floor(cents(money) / (pricePerUnit * 100) + 1e-9);
}

/** What a number of credits costs, rounded to the cent the gateway charges. */
export function priceOfCredits(credits: number, pricePerUnit: number): number {
    return cents(credits * pricePerUnit) / 100;
}

/** Why a typed top-up is refused, with the limit it broke for the message. */
export type TopUpRefusal =
    | { code: "credit_top_up_typed_off" }
    | { code: "credit_top_up_below_min"; min: number }
    | { code: "credit_top_up_above_max"; max: number };

/**
 * The next tier a larger payment would reach, and how much more it takes.
 *
 * Only a tier with a higher percent than the payment already earns counts:
 * "add 50 more for 10%" while 10% is already paid is noise. Across several
 * running campaigns the nearest such tier is offered.
 */
export interface NextTier {
    percent: number;
    /** Money still to add, in the site currency. */
    missing: number;
}

/** One typed top-up, quoted. */
export interface TopUpQuote {
    credits: number;
    /** What the gateway is asked for, before the payment method's fee. */
    paid: number;
    bonus: CampaignBonus | null;
    next: NextTier | null;
    refusal: TopUpRefusal | null;
}

function nextTier(campaigns: readonly BonusCampaign[], paid: number, earned: number, at: Date): NextTier | null {
    let best: NextTier | null = null;
    for (const campaign of campaigns) {
        if (!campaignRunning(campaign, at)) continue;
        for (const tier of readTiers(campaign.tiers)) {
            if (cents(tier.minAmount) <= cents(paid) || tier.percent <= earned) continue;
            const missing = (cents(tier.minAmount) - cents(paid)) / 100;
            if (!best || missing < best.missing || (missing === best.missing && tier.percent > best.percent)) {
                best = { percent: tier.percent, missing };
            }
        }
    }
    return best;
}

/**
 * A top-up of this many credits: the price, the campaign bonus it earns now,
 * the tier a little more would reach, and whether the limits allow it.
 *
 * The bonus comes from `bestBonus`, the function a package's bonus comes
 * from, taken on the price before the payment method's fee.
 */
export function quoteTopUp(credits: number, limits: TopUpLimits, campaigns: readonly BonusCampaign[], at: Date): TopUpQuote {
    const whole = Number.isFinite(credits) && credits > 0 ? Math.floor(credits) : 0;
    const paid = priceOfCredits(whole, limits.pricePerUnit);
    const bonus = bestBonus(campaigns, { paid, baseCredits: whole }, at);
    let refusal: TopUpRefusal | null = null;
    if (cents(paid) < cents(limits.min)) refusal = { code: "credit_top_up_below_min", min: limits.min };
    else if (cents(paid) > cents(limits.max)) refusal = { code: "credit_top_up_above_max", max: limits.max };
    else if (!limits.typed && !limits.presets.some((preset) => creditsFor(preset, limits.pricePerUnit) === whole)) {
        // With typing off, only a preset may be bought. Compared in credits,
        // which is what the route receives.
        refusal = { code: "credit_top_up_typed_off" };
    }
    return { credits: whole, paid, bonus, next: nextTier(campaigns, paid, bonus?.percent ?? 0, at), refusal };
}
