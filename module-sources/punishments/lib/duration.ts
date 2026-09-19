/**
 * How long a punishment lasts, read from the shorthand an operator types.
 *
 * `duration` is a free text column and nothing ever read it. `punishmentStatus`
 * decides whether a punishment is still in force from `expiresAt` alone, and
 * `expiresAt` was only ever set from a second box below the duration field,
 * labelled "End date (optional)". So somebody who typed `7d` - which is what
 * the field is for, the label says so - and left the optional box alone issued
 * a permanent ban that showed as Active for ever.
 *
 * Two boxes for one answer, one of them decorative. The shorthand is the one
 * an operator reaches for, so the shorthand is what decides.
 *
 * Three answers, not two:
 *
 *   a date  - the length was understood and this is when it ends;
 *   `null`  - no end was asked for, which is what "permanent" and an empty
 *             box both mean;
 *   `undefined` - this is not a length. The caller answers 400 rather than
 *             storing a permanent ban somebody thought was a week, which is
 *             the failure this whole file exists to prevent.
 */

const UNIT_MS: Record<string, number> = {
    m: 60_000,
    h: 60 * 60_000,
    d: 24 * 60 * 60_000,
    w: 7 * 24 * 60 * 60_000,
    M: 30 * 24 * 60 * 60_000,
};

/** `7d`, `24h`, `30m`, `2w`, `3M`, or `permanent`. Case matters only for M. */
const SHORTHAND = /^(\d+)([mhdwM])$/;

export function parseDuration(
    duration: string | null | undefined,
    from: Date = new Date(),
): Date | null | undefined {
    const text = (duration ?? "").trim();
    if (text === "" || text.toLowerCase() === "permanent") return null;

    const parts = SHORTHAND.exec(text);
    if (!parts) return undefined;

    const amount = Number(parts[1]);
    // `0d` is not a punishment, and a ceiling keeps a typo from producing a
    // date the database cannot hold.
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) return undefined;

    return new Date(from.getTime() + amount * UNIT_MS[parts[2]]);
}

/** Every unit the shorthand takes, for a screen that offers them. */
export const DURATION_UNITS = ["m", "h", "d", "w", "M"] as const;

export type DurationUnit = (typeof DURATION_UNITS)[number];
