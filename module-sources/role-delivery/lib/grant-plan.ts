/**
 * Handing a rank over when a listing sells, and the three ways that goes wrong.
 *
 * The market moves credits and takes a cut and does not know what is being
 * sold; whatever is installed says what it can deliver.
 *
 * A rank used to be the hardest of those things to deliver, because a member
 * held exactly one role: handing one over changed what the buyer was, and
 * putting it back thirty days later meant having remembered it. A member holds
 * a set now, so a rank is added to what they already have and the lapse takes
 * back only itself. Half of this file went with that change, including the
 * distinction between writing a grant and extending one, which core's
 * `grantRole` now answers.
 *
 * What is left is the two refusals that must happen before any credits move,
 * which is the one moment a refusal costs nothing:
 *
 * A role deleted since the listing was written. The market asks again at the
 * moment of sale for exactly this reason, and answering "handled" for a role
 * that is not there is a sale nobody unpicks until the buyer complains.
 *
 * A buyer who already holds the rank for good, because an operator gave it to
 * them. Selling thirty days of something they hold permanently takes money for
 * nothing: the grant cannot make it more permanent, and it must not make it
 * less.
 */

export interface WantedRole {
    roleId: string;
    days: number;
}

/** What the buyer already holds of this rank, if anything. */
export interface StandingGrant {
    /** Null means they hold it permanently, which is what makes a sale pointless. */
    expiresAt: Date | null;
}

/** The site's own answer: which roles exist right now. */
export interface RoleWorld {
    existingRoleIds: ReadonlySet<string>;
}

export type GrantPlan =
    /** Hand it over until this date. Core decides whether that writes or extends. */
    | { grant: { roleId: string; expiresAt: Date } }
    | { refuse: "unknown_role" | "bad_duration" | "already_held" };

/** As long as a listing may sell a rank for. Ten years is nobody's intent. */
const MAX_DAYS = 3650;

export function planGrant(
    wanted: WantedRole,
    standing: StandingGrant | null,
    world: RoleWorld,
    now: Date,
): GrantPlan {
    const roleId = wanted.roleId.trim();
    if (roleId === "" || !world.existingRoleIds.has(roleId)) return { refuse: "unknown_role" };

    if (!Number.isFinite(wanted.days) || wanted.days < 1 || wanted.days > MAX_DAYS) {
        return { refuse: "bad_duration" };
    }
    const days = Math.floor(wanted.days);

    // Held for good. Nothing is going to take it away, so time cannot be sold
    // against it: the grant would either do nothing or quietly put an end date
    // on something an operator meant to be permanent.
    if (standing && standing.expiresAt === null) return { refuse: "already_held" };

    // From whichever is later. Twenty-five days left plus thirty bought is
    // fifty-five; starting again is taking money for days it then deletes.
    const from = standing && standing.expiresAt && standing.expiresAt > now ? standing.expiresAt : now;
    return { grant: { roleId, expiresAt: new Date(from.getTime() + days * 86_400_000) } };
}
