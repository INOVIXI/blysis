/**
 * What a wheel is, beyond a list of prizes.
 *
 * There was one wheel. It was free, it turned once a day for everybody, and
 * an extra turn cost a number in a module setting - which is a reasonable
 * shape for exactly one community and no shape at all for the rest. A daily
 * free wheel for everyone and a weekly wheel for the people who bought a rank
 * are two different wheels, not two settings on one, and the moment a second
 * wheel exists the cooldown, the price and who may reach it all belong to the
 * wheel rather than to the module.
 */

/** How often one person may turn a given wheel. */
export const WHEEL_COOLDOWNS = ["none", "daily", "weekly", "monthly", "custom"] as const;

export type WheelCooldown = (typeof WHEEL_COOLDOWNS)[number];

export interface WheelRules {
    cooldown: string;
    /** Hours between turns when the cooldown is `custom`. */
    cooldownHours: number;
    /** What one turn costs in credits. Zero is free. */
    cost: number;
    /** Role ids that may turn it. Empty means anyone with an account. */
    roleIds: string[];
    isActive: boolean;
    /** Whether anything is on it. A wheel with no prizes cannot be turned. */
    hasPrizes: boolean;
}

/** Hours in each named cooldown; `custom` carries its own. */
const HOURS: Record<string, number> = {
    none: 0,
    daily: 24,
    weekly: 24 * 7,
    monthly: 24 * 30,
};

export function cooldownHoursOf(rules: Pick<WheelRules, "cooldown" | "cooldownHours">): number {
    if (rules.cooldown === "custom") return Math.max(0, rules.cooldownHours);
    return HOURS[rules.cooldown] ?? 0;
}

/**
 * When this person may turn this wheel again.
 *
 * Measured from their last turn rather than from a calendar boundary: a daily
 * wheel that resets at midnight is a wheel everyone turns twice in five
 * minutes on either side of it.
 */
export function nextTurnAt(
    rules: Pick<WheelRules, "cooldown" | "cooldownHours">,
    lastTurn: Date | null,
): Date | null {
    const hours = cooldownHoursOf(rules);
    if (!lastTurn || hours <= 0) return null;
    return new Date(lastTurn.getTime() + hours * 3_600_000);
}

export type Refusal =
    | "signed_out"
    | "wheel_off"
    | "no_prizes"
    | "wrong_role"
    | "too_soon"
    | "not_enough_credits"
    | null;

export interface Turner {
    signedIn: boolean;
    roleId: string | null;
    credits: number;
    lastTurn: Date | null;
}

/**
 * Why this person cannot turn this wheel, or null when they can.
 *
 * One function, so the page that draws the button, the endpoint that refuses
 * the request and the test that pins the rules cannot drift into three
 * different answers - which is how a disabled button and a working endpoint
 * end up in the same release.
 */
export function refusalFor(rules: WheelRules, turner: Turner, now: Date = new Date()): Refusal {
    if (!rules.isActive) return "wheel_off";
    // Before "sign in" and before the cooldown, because it is the one refusal
    // the reader cannot act on: signing in and waiting a day both lead back to
    // a blank disc. The endpoint has always refused this; the page drew an
    // enabled button over it until the rule moved here.
    if (!rules.hasPrizes) return "no_prizes";
    if (!turner.signedIn) return "signed_out";
    if (rules.roleIds.length > 0 && (!turner.roleId || !rules.roleIds.includes(turner.roleId))) {
        return "wrong_role";
    }
    const next = nextTurnAt(rules, turner.lastTurn);
    if (next && next > now) return "too_soon";
    if (rules.cost > 0 && turner.credits < rules.cost) return "not_enough_credits";
    return null;
}

/**
 * The prize a turn lands on.
 *
 * Weighted, and the weights are the operator's: zero is how a prize is
 * switched off without deleting it. All of them zero is not an error to
 * divide by - it is a wheel with nothing on it, which the caller has to say
 * differently from a wheel with no prizes at all.
 */
/**
 * The kinds of prize this wheel can actually hand over.
 *
 * The spin route grants credits and mints a coupon, and does nothing at all
 * for anything else. The demo ships four prizes of kind `item` - three keys
 * and a week of VIP - which are drawn, written to the spin log, announced in
 * the public feed and notified to the winner, who receives nothing. A kind
 * nothing grants is not a prize, so the panel says which ones are like that
 * rather than leaving an operator to find out from a complaint.
 */
export const GRANTABLE_PRIZE_KINDS = ["credits", "coupon", "nothing"] as const;

export function prizeIsGrantable(type: string): boolean {
    return (GRANTABLE_PRIZE_KINDS as readonly string[]).includes(type);
}

/**
 * How often a prize actually comes up, as a percentage of the wheel.
 *
 * The number an operator types is a weight, not a percentage: the draw adds
 * them up and takes a share. The box told them otherwise - "Probability
 * (1-100)" - so three prizes at 100 read as certain three times over when
 * they are a third each, and an operator tuning one number moved every other
 * prize's odds without being shown it.
 *
 * A prize switched off is not on the wheel, so it has no chance and does not
 * count against the ones that do.
 */
export function prizeChance<T extends { probability: number; isActive?: boolean }>(
    prizes: readonly T[],
    prize: T,
): number {
    if (prize.isActive === false) return 0;
    const live = prizes.filter((one) => one.isActive !== false);
    const total = live.reduce((sum, one) => sum + Math.max(0, one.probability), 0);
    if (total <= 0) return 0;
    return (Math.max(0, prize.probability) / total) * 100;
}

export function drawPrize<T extends { probability: number }>(
    prizes: T[],
    roll: (max: number) => number,
): T | null {
    const total = prizes.reduce((sum, prize) => sum + Math.max(0, prize.probability), 0);
    if (total <= 0) return null;

    // Accumulate rather than subtract. Subtracting and testing `<= 0` hands
    // the turn to a prize with odds of zero whenever the roll lands exactly on
    // zero - which is the one prize an operator has switched off, and the one
    // that must never come up. Rare enough to survive a long time unnoticed,
    // which is why it is written down here.
    const point = roll(Math.ceil(total * 1000)) / 1000;
    let reached = 0;
    for (const prize of prizes) {
        reached += Math.max(0, prize.probability);
        if (point < reached) return prize;
    }
    return prizes[prizes.length - 1] ?? null;
}

/**
 * Which ink a prize name can be read in, on the colour of its own slice.
 *
 * Every label was white. Most of the palette the prize form offers is dark
 * enough for that; the amber in it is not - white on #eab308 measures about
 * 1.9:1, and the name of the prize is the one thing the wheel exists to say.
 *
 * White stays the wheel's ink wherever it can be read: black and white labels
 * mixed across one wheel reads as an accident rather than a decision. It
 * gives way only where white fails outright, which is 3:1 - AA for text this
 * size - and on that palette it is the yellows, the ambers and the mid greens
 * that fall below it.
 *
 * Choosing the better of two inks is not the same as passing AA: a mid grey
 * fails against both, and the colour is the operator's. It is the best either
 * choice can do.
 *
 * Anything that is not a hex colour gets white, which is what the wheel drew
 * before this existed: the colour field takes free text, and a label that is
 * hard to read beats a label that throws.
 */
export function inkFor(background: string): "light" | "dark" {
    const hex = background.trim().replace(/^#/, "");
    const full = hex.length === 3 ? hex.split("").map((digit) => digit + digit).join("") : hex;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return "light";

    const channel = (at: number) => {
        const value = parseInt(full.slice(at, at + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
    const whiteOnIt = 1.05 / (luminance + 0.05);
    return whiteOnIt < 3 ? "dark" : "light";
}
