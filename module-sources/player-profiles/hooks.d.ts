/**
 * What this module asks the rest of the site about a member.
 *
 * It used to keep a `LinkedAccount` row that a member wrote themselves: the
 * profile tab had a text box, and whatever was typed into it was recorded as
 * theirs and shown on their public profile. Nothing checked it, and the
 * uniqueness constraint meant the first person to type a name owned it.
 *
 * A link is a claim about an account somewhere else, so only the module that
 * can reach that somewhere else can prove it. This module asks; a module that
 * has proved something answers.
 */

export interface LinkedAccountSummary {
    /** Whose it is, in the answering module's own words - "minecraft". */
    provider: string;
    /** The name to print. Null where the module has one it will not publish. */
    username: string | null;
    /** A picture that came with the identity, if the module has one. */
    avatar: string | null;
}

declare global {
    interface BlysisFilterPayloads {
        /** Every account somebody has proved is theirs. */
        "profile.linkedAccounts": LinkedAccountSummary[];
    }

    interface BlysisFilterContexts {
        /** The member being looked at, who is not always the one looking. */
        "profile.linkedAccounts": { userId: string };
    }
}

export {};
