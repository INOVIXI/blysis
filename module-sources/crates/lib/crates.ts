/**
 * What a crate is, beyond a list of rewards.
 *
 * Pure, so the page that draws the button, the endpoint that refuses the
 * request and the tests that pin the rules all ask the same functions. Two
 * copies of "may this person open it" is how a disabled button and a working
 * endpoint end up in the same release.
 *
 * The draw and the odds are the wheel's, copied rather than imported because
 * a module never imports another: the same accumulate-not-subtract rule, so a
 * reward with a weight of zero can never come out.
 */

/** How long a per-person limit counts back. */
export const CRATE_PERIODS = ["day", "week", "month", "ever"] as const;

export type CratePeriod = (typeof CRATE_PERIODS)[number];

/** What a reward can hand over. Anything else is a promise nobody keeps. */
export const REWARD_KINDS = ["credits", "product", "nothing"] as const;

export type RewardKind = (typeof REWARD_KINDS)[number];

/**
 * How rare a reward looks. Each is drawn in one of the theme's own colours,
 * so a crate reads the same in light and dark and in every theme rather than
 * in whatever hex an operator picked on a white background.
 */
export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;

export type Rarity = (typeof RARITIES)[number];

/** The badge tone each rarity is drawn in. An unknown one reads as common. */
export function rarityTone(rarity: string): "neutral" | "success" | "info" | "warning" | "danger" {
    switch (rarity) {
        case "uncommon": return "success";
        case "rare": return "info";
        case "epic": return "warning";
        case "legendary": return "danger";
        default: return "neutral";
    }
}

const PERIOD_MS: Record<string, number> = {
    day: 24 * 3_600_000,
    week: 7 * 24 * 3_600_000,
    month: 30 * 24 * 3_600_000,
};

/**
 * Where a per-person limit starts counting, or null to count every opening.
 *
 * Rolling rather than from a calendar boundary, for the reason the wheel
 * measures its cooldown from the last turn: a limit that resets at midnight is
 * a limit everyone uses twice in five minutes on either side of it.
 */
export function limitWindowStart(period: string, now: Date): Date | null {
    const span = PERIOD_MS[period];
    return span ? new Date(now.getTime() - span) : null;
}

export interface CrateRules {
    isActive: boolean;
    /** Credits per opening. Zero means it is not sold for credits. */
    cost: number;
    /** Whether a key can be bought for it in the store. */
    sellsKeys: boolean;
    perPersonLimit: number;
    roleIds: string[];
    /** Whether anything that can come out of it is switched on and weighted. */
    hasRewards: boolean;
}

export interface Opener {
    signedIn: boolean;
    roleId: string | null;
    credits: number;
    keys: number;
    /** How many times they opened it inside the limit's window. */
    openedInWindow: number;
}

export type PayWith = "key" | "credits";

export type Refusal =
    | "crate_off"
    | "no_rewards"
    | "signed_out"
    | "wrong_role"
    | "limit_reached"
    | "no_key"
    | "not_enough_credits"
    | "not_for_sale";

/**
 * How this opening would be paid for, given what the member asked for.
 *
 * A member who holds a key and says nothing spends the key: it is already
 * paid for, and spending credits while a bought key sits unused is a support
 * ticket. Asking for credits on a crate that is not sold for credits is
 * answered as such rather than quietly turned into a key.
 */
export function paymentFor(rules: Pick<CrateRules, "cost">, opener: Pick<Opener, "keys">, asked: PayWith | null): PayWith | null {
    if (asked === "key") return "key";
    if (asked === "credits") return rules.cost > 0 ? "credits" : null;
    if (opener.keys > 0) return "key";
    return rules.cost > 0 ? "credits" : null;
}

/**
 * Why this person cannot open this crate this way, or null when they can.
 *
 * The limit comes before the payment, so a member at their limit is told so
 * rather than that they cannot afford it - the second one invites them to buy
 * something that would not help.
 */
export function refusalFor(rules: CrateRules, opener: Opener, pay: PayWith | null): Refusal | null {
    if (!rules.isActive) return "crate_off";
    if (!rules.hasRewards) return "no_rewards";
    if (!opener.signedIn) return "signed_out";
    if (rules.roleIds.length > 0 && (!opener.roleId || !rules.roleIds.includes(opener.roleId))) {
        return "wrong_role";
    }
    if (rules.perPersonLimit > 0 && opener.openedInWindow >= rules.perPersonLimit) return "limit_reached";
    if (pay === null) return rules.sellsKeys ? "no_key" : "not_for_sale";
    if (pay === "key" && opener.keys <= 0) return "no_key";
    if (pay === "credits" && opener.credits < rules.cost) return "not_enough_credits";
    return null;
}

/**
 * How often a reward comes out, as a percentage of the crate.
 *
 * The number an operator types is a weight. Published as a percentage because
 * a crate somebody pays for has to say what is in it and how likely each thing
 * is before they pay: that is the difference between a crate and a slot
 * machine. A reward switched off is not in the crate and does not count
 * against the ones that are.
 */
export function rewardChance<T extends { weight: number; isActive?: boolean }>(rewards: readonly T[], reward: T): number {
    if (reward.isActive === false) return 0;
    const live = rewards.filter((one) => one.isActive !== false);
    const total = live.reduce((sum, one) => sum + Math.max(0, one.weight), 0);
    if (total <= 0) return 0;
    return (Math.max(0, reward.weight) / total) * 100;
}

/**
 * The reward an opening lands on.
 *
 * `roll(max)` returns an integer in [0, max). The route passes
 * `crypto.randomInt`, so the outcome is decided on the server from a source a
 * member cannot predict or replay; tests pass a fixed one.
 *
 * Accumulate rather than subtract: subtracting and testing `<= 0` hands the
 * draw to a reward with a weight of zero whenever the roll lands exactly on
 * zero, which is the one reward an operator switched off.
 */
export function drawReward<T extends { weight: number }>(rewards: readonly T[], roll: (max: number) => number): T | null {
    const total = rewards.reduce((sum, reward) => sum + Math.max(0, reward.weight), 0);
    if (total <= 0) return null;
    const point = roll(total);
    let reached = 0;
    for (const reward of rewards) {
        reached += Math.max(0, reward.weight);
        if (point < reached) return reward;
    }
    return null;
}

/** Whether a reward, as it stands, gives the member anything. */
export function rewardHandsSomethingOver(reward: { kind: string; productId?: string | null; value: number }): boolean {
    if (reward.kind === "credits") return reward.value > 0;
    if (reward.kind === "product") return Boolean(reward.productId);
    return reward.kind === "nothing";
}
