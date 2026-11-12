import { zonedNow } from "@/core/sdk";

/**
 * When a product is for sale, and what it costs while it is.
 *
 * The shop had one switch per product - active or not - so every shape a
 * community actually sells needed a person watching a clock: a seasonal pack
 * switched on by hand on the 20th, a Friday evening offer somebody had to be
 * awake for, "one per account" enforced by reading the orders afterwards and
 * apologising.
 *
 * Four rules live here: a run between two dates, a weekly window, a limit per
 * person, and an allowance that refills. Each is asked in three places - the
 * list that decides what to draw, the button that decides whether to offer,
 * and the checkout that decides whether to take the money - so they are one
 * function. The third is the one that matters; the first two are a courtesy,
 * and a limit enforced only in a browser is not a limit.
 *
 * Every hour here is the site's own clock. "Friday at 18:00" is not a moment
 * until somebody says whose, and the only answer that starts a limited run at
 * the same instant for everybody is the operator's.
 */

/** How long a per-person limit or a refilling allowance counts for. */
export const LIMIT_PERIODS = ["ever", "day", "week", "month"] as const;
export type LimitPeriod = (typeof LIMIT_PERIODS)[number];

/** What a visitor sees when the product is not for sale right now. */
export const OUTSIDE_WINDOW = ["countdown", "hidden"] as const;
export type OutsideWindow = (typeof OUTSIDE_WINDOW)[number];

/**
 * How long a checkout still waiting for its payment holds a per-person
 * allowance or a coupon's per-customer use. Long enough for a payment page;
 * an abandoned one lets go.
 */
export const AWAITING_PAYMENT_MS = 60 * 60_000;

export interface ProductRules {
    isActive: boolean;
    /** Role ids that may buy it. Empty means anyone. */
    roleIds: string[];
    /**
     * Products the buyer must already own. Empty asks for nothing.
     *
     * Every upgrade path has this shape: the tier above is for people already
     * on the tier below. Without it the rule can only be written in the
     * product's description and enforced by refunding whoever did not read it.
     */
    requiresProductIds: string[];
    /** Own any one of the list rather than all of it. */
    requiresAny: boolean;
    /** The run: absolute instants, so they mean the same thing everywhere. */
    availableFrom: Date | null;
    availableUntil: Date | null;
    /** Weekly window: 0 is Sunday. Empty means every day. */
    availableDays: number[];
    /** Minutes past midnight on the site's clock. Null means all day. */
    availableFromMinute: number | null;
    availableUntilMinute: number | null;
    outsideWindow: string;
    perPersonLimit: number | null;
    perPersonPeriod: string;
    periodStock: number | null;
    periodStockWindow: string;
    /** The permanent count, which is a different thing: it does not refill. */
    stock: number | null;
    price: number;
    salePrice: number | null;
    saleFrom: Date | null;
    saleUntil: Date | null;
}

/** What the caller had to look up before asking. */
export interface Counts {
    /** The buyer's role, for a product sold to certain ranks. */
    roleId?: string | null;
    /** What this person already owns, for a product that needs another first. */
    ownedProductIds?: Set<string>;
    /** Paid units this person already has, inside the per-person period. */
    boughtByPerson: number;
    /** Paid units everyone has, inside the refilling period. */
    soldInPeriod: number;
}

export type AvailabilityState =
    | "open"
    | "off"
    | "wrong_role"
    | "needs_product"
    | "early"
    | "ended"
    | "closed"
    | "sold_out"
    | "sold_out_for_now"
    | "limit_reached";

export interface Availability {
    state: AvailabilityState;
    buyable: boolean;
    /** When it next opens, for a page that wants to count down to it. */
    opensAt: Date | null;
    /** When the current opening ends, for the other kind of countdown. */
    closesAt: Date | null;
    /** How many more this person may buy, when there is a per-person limit. */
    remainingForPerson: number | null;
    /** How many are left in the current allowance, when there is one. */
    remainingInPeriod: number | null;
}

const DAY = 86_400_000;

/**
 * True when this moment is inside the weekly window.
 *
 * Exported because a campaign keeps the same kind of hours and must wrap past
 * midnight the same way. Two implementations of that rule is one of them
 * quietly shutting a shop in the middle of its own event.
 *
 * The day and the hour cannot be asked separately, because a window may cross
 * midnight: "Fridays, 22:00 to 02:00" is open at half past midnight on
 * Saturday, and a check that reads Saturday against a Friday list shuts the
 * shop in the middle of its own opening. So a wrapped window's small hours
 * are matched against the day before.
 */
export function insideWeeklyWindow(
    weekday: number,
    minutes: number,
    days: number[],
    from: number | null,
    until: number | null,
): boolean {
    const onDay = (day: number) => days.length === 0 || days.includes(day);

    if (from === null && until === null) return onDay(weekday);

    const start = from ?? 0;
    const end = until ?? 24 * 60;

    if (start <= end) return onDay(weekday) && minutes >= start && minutes < end;

    // Wrapped. Before midnight it is today's window; after midnight it is
    // yesterday's, still running.
    if (minutes >= start) return onDay(weekday);
    if (minutes < end) return onDay((weekday + 6) % 7);
    return false;
}

/**
 * The next instant this product's weekly window opens.
 *
 * Walked day by day rather than solved, because a zone's offset is not a
 * constant - the answer has to be built from the wall clock the shop will
 * actually be showing that morning.
 */
export function nextOpening(rules: ProductRules, now: Date, zone: string): Date | null {
    const startMinute = rules.availableFromMinute ?? 0;
    const days = rules.availableDays;
    if (days.length === 0 && rules.availableFromMinute === null) return null;

    for (let ahead = 0; ahead <= 7; ahead++) {
        const probe = new Date(now.getTime() + ahead * DAY);
        const { weekday } = zonedNow(probe, zone);
        if (days.length > 0 && !days.includes(weekday)) continue;

        // Midnight of that day on the site's clock, plus the opening minute.
        const midnight = new Date(probe.getTime() - zonedNow(probe, zone).minutes * 60_000);
        const opensAt = new Date(midnight.getTime() + startMinute * 60_000);
        if (opensAt > now) {
            if (rules.availableUntil && opensAt > rules.availableUntil) return null;
            return opensAt;
        }
    }
    return null;
}

/** The start of the period a limit counts over. */
export function periodStart(period: string, now: Date): Date | null {
    const at = new Date(now);
    switch (period) {
        case "day":
            at.setUTCHours(0, 0, 0, 0);
            return at;
        case "week": {
            at.setUTCHours(0, 0, 0, 0);
            at.setUTCDate(at.getUTCDate() - at.getUTCDay());
            return at;
        }
        case "month": {
            at.setUTCHours(0, 0, 0, 0);
            at.setUTCDate(1);
            return at;
        }
        default:
            // "ever": no start, so the count is every paid order there is.
            return null;
    }
}

export function availabilityOf(
    rules: ProductRules,
    counts: Counts,
    now: Date,
    zone: string,
): Availability {
    const answer = (
        state: AvailabilityState,
        extra: Partial<Availability> = {},
    ): Availability => ({
        state,
        buyable: state === "open",
        opensAt: null,
        closesAt: null,
        remainingForPerson: rules.perPersonLimit === null
            ? null
            : Math.max(0, rules.perPersonLimit - counts.boughtByPerson),
        remainingInPeriod: rules.periodStock === null
            ? null
            : Math.max(0, rules.periodStock - counts.soldInPeriod),
        ...extra,
    });

    if (!rules.isActive) return answer("off");

    // Before the clock: a rank is the one refusal a shopper cannot wait out,
    // and telling them to come back on Friday wastes their Friday.
    if (rules.roleIds.length > 0 && (!counts.roleId || !rules.roleIds.includes(counts.roleId))) {
        return answer("wrong_role");
    }

    // Before the clock, after the rank. A rank is the one refusal nobody can
    // act on, so it is said first; this one they can act on, and telling them
    // to come back on Friday for something they cannot buy wastes their Friday.
    if (rules.requiresProductIds.length > 0) {
        const owned = counts.ownedProductIds ?? new Set<string>();
        const enough = rules.requiresAny
            ? rules.requiresProductIds.some((id) => owned.has(id))
            : rules.requiresProductIds.every((id) => owned.has(id));
        if (!enough) return answer("needs_product");
    }

    if (rules.availableFrom && now < rules.availableFrom) {
        return answer("early", { opensAt: rules.availableFrom });
    }
    if (rules.availableUntil && now >= rules.availableUntil) {
        return answer("ended");
    }

    const { weekday, minutes } = zonedNow(now, zone);
    const open = insideWeeklyWindow(
        weekday,
        minutes,
        rules.availableDays,
        rules.availableFromMinute,
        rules.availableUntilMinute,
    );
    if (!open) {
        return answer("closed", { opensAt: nextOpening(rules, now, zone) });
    }

    // The permanent count comes before the refilling one: a shop with none
    // left has none left, whatever today's allowance says.
    if (rules.stock !== null && rules.stock <= 0) return answer("sold_out");

    if (rules.periodStock !== null && counts.soldInPeriod >= rules.periodStock) {
        // Not "ended": tomorrow it sells again, and a page that says
        // otherwise sends the reader away for good.
        const refillsAt = periodStart(rules.periodStockWindow, new Date(now.getTime() + DAY));
        return answer("sold_out_for_now", { opensAt: refillsAt });
    }

    if (rules.perPersonLimit !== null && counts.boughtByPerson >= rules.perPersonLimit) {
        return answer("limit_reached");
    }

    const closesAt = rules.availableUntil ?? null;
    return answer("open", { closesAt });
}

/**
 * What a shopper pays right now.
 *
 * A sale with no dates is a sale that is on; one with dates is on between
 * them. A sale price above the ordinary price is a typo in a form, not a
 * price rise, so it is ignored rather than charged.
 */
export function effectivePrice(
    rules: Pick<ProductRules, "price" | "salePrice" | "saleFrom" | "saleUntil">,
    now: Date,
): { price: number; was: number | null; onSale: boolean } {
    const { price, salePrice, saleFrom, saleUntil } = rules;
    const dated = (!saleFrom || now >= saleFrom) && (!saleUntil || now < saleUntil);
    const sensible = salePrice !== null && salePrice > 0 && salePrice < price;
    if (!dated || !sensible) return { price, was: null, onSale: false };
    return { price: salePrice as number, was: price, onSale: true };
}
