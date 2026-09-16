/**
 * What a member may change about who they are, and what it costs them.
 *
 * Three separate questions an operator answers differently depending on what
 * kind of site they run. A community where the name is the identity does not
 * want it changed every week; a shop does not care. A site that sells things
 * wants the address on the invoice to be the address somebody can read.
 *
 * No imports, for the reason `member-uploads.ts` has none: the settings screen
 * that offers these switches is a client component, and a file that reads the
 * database cannot be named from one without pulling Prisma into the browser
 * bundle - `client-bundle-safety` measures exactly that. This file says what
 * the keys are and what their values mean; whoever has a database connection
 * does the reading.
 */

/** Whether a member may change their own username. */
export const MEMBER_USERNAME_CHANGES_KEY = "member_username_changes";

/** Whether a member may change their own e-mail address. */
export const MEMBER_EMAIL_CHANGES_KEY = "member_email_changes";

/** Whether changing either one asks for the current password first. */
export const IDENTITY_REQUIRES_PASSWORD_KEY = "identity_requires_password";

/** Whether a new e-mail address has to be proved before it takes effect. */
export const EMAIL_CHANGE_VERIFICATION_KEY = "email_change_verification";

/**
 * Stored as JSON, so a value arrives as a boolean from a toggle and as a
 * string from a choice control, and both have to mean the same thing.
 */
function on(stored: unknown, fallback: boolean): boolean {
    if (stored === undefined || stored === null || stored === "") return fallback;
    if (typeof stored === "boolean") return stored;
    if (typeof stored === "string") return stored !== "false" && stored !== "0";
    return fallback;
}

/**
 * On unless turned off. Changing a username is what members could already do,
 * and a switch that silently took it away on upgrade would be a change nobody
 * asked for.
 */
export function memberUsernameChanges(stored: unknown): boolean {
    return on(stored, true);
}

/**
 * Off unless turned on. Members could not change their address at all before
 * this, and an address is what a password reset is sent to: opening that door
 * is a decision an operator makes on purpose, not one they inherit.
 */
export function memberEmailChanges(stored: unknown): boolean {
    return on(stored, false);
}

/**
 * On unless turned off. Somebody who walks up to an unlocked screen should not
 * be able to take the account by rewriting the address the reset link goes to,
 * and the password is the only thing at hand that proves the person sitting
 * there is the owner.
 */
export function identityRequiresPassword(stored: unknown): boolean {
    return on(stored, true);
}

/**
 * On unless turned off. An unproved address is worse than the old one: a typo
 * moves every future reset link to a mailbox nobody reads, and a deliberate
 * one moves it to somebody else's.
 */
export function emailChangeVerification(stored: unknown): boolean {
    return on(stored, true);
}
