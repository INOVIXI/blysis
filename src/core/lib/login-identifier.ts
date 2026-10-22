/**
 * What the login form's first field means.
 *
 * Registration captures a username as well as an email, and both columns are
 * unique, so an account has two names an operator reasonably expects to be
 * able to sign in with. Accepting only the email left every user who
 * remembered their username locked out of an account whose password they
 * knew.
 *
 * The two are told apart by the "@": the registration schema restricts a
 * username to `[A-Za-z0-9_-]`, so a value containing one cannot be a username
 * on any account this platform created. Branching on that keeps the lookup on
 * a unique index and keeps the result deterministic, which an `OR` across both
 * columns would not be if a legacy row ever held an "@" in its username.
 *
 * Both are stored as they were typed at registration, and somebody who
 * registered `lonely_adam05` types `Lonely_Adam05` the next week, so the
 * account is found without regard to case. See `accountFor`.
 */
export type IdentifierLookup = { email: string } | { username: string };

/**
 * Turns a submitted identifier into a Prisma `where` clause.
 *
 * Returns null for anything that cannot identify an account, so the caller
 * rejects the attempt without a database round-trip.
 */
export function identifierLookup(raw: unknown): IdentifierLookup | null {
    if (typeof raw !== "string") return null;
    // Browsers and password managers both leave stray whitespace behind.
    const value = raw.trim();
    if (value.length === 0) return null;
    return value.includes("@") ? { email: value } : { username: value };
}

/** The part of the Prisma client `accountFor` reads. */
export interface AccountLookupClient {
    user: {
        findMany(args: {
            where: Record<string, { equals: string; mode: "insensitive" }>;
            select: { id: true; email: true; username: true };
            take: number;
        }): Promise<{ id: string; email: string; username: string }[]>;
    };
}

/**
 * The account a sign-in names, found without regard to case.
 *
 * A site may still hold two accounts whose names differ only in case, made
 * before a username was held to one person however it was capitalised. The
 * exact spelling decides between them, and a spelling that matches more than
 * one and none exactly finds nobody: signing a member into somebody else's
 * account is worse than asking them to type their name as they registered it.
 * `tests/unit/login-identifier.test.ts`.
 */
export async function accountFor(lookup: IdentifierLookup, client: AccountLookupClient): Promise<{ id: string } | null> {
    const [field, value] = "email" in lookup ? (["email", lookup.email] as const) : (["username", lookup.username] as const);
    const matches = await client.user.findMany({
        where: { [field]: { equals: value, mode: "insensitive" } },
        select: { id: true, email: true, username: true },
        take: 10,
    });
    const exact = matches.find((row) => row[field] === value);
    if (exact) return { id: exact.id };
    return matches.length === 1 ? { id: matches[0].id } : null;
}
