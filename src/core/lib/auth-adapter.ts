/**
 * The Auth.js database adapter, mapped onto core's `User` model.
 *
 * `@auth/prisma-adapter` assumes the schema Auth.js documents: a `User` with
 * `name` and `image` and nothing required beyond `email`. Core's user is older
 * than that and different - it has `username` (required and unique) and
 * `avatar`, and no `name`/`image` at all - so the stock adapter's
 * `user.create({ data: { name, email, image } })` cannot even be compiled by
 * Prisma, let alone succeed. Every first OAuth sign-in failed on it.
 *
 * So the stock adapter is wrapped rather than replaced: session, account and
 * verification-token handling are already right, and only the user half is
 * translated here.
 *
 * Three things are translated:
 *
 * - **`name` <-> `username`.** A display name is free-form and can repeat; a
 *   username is unique, so it is slugged and, on collision, suffixed. It is
 *   set once at sign-up and never overwritten afterwards, because the person
 *   (or an admin) may have changed it deliberately.
 * - **`image` <-> `avatar`.** A straight rename.
 * - **A missing email.** Several identity providers never hand one over
 *   (Battle.net, Epic Games, Kick, Reddit, TikTok, Instagram, and X unless the
 *   app is approved for it), but `User.email` is required and unique. Those
 *   accounts get a placeholder in the `.invalid` TLD, reserved by RFC 6761 so
 *   it can never resolve or be delivered to. `emailVerified` stays null and
 *   nothing is ever sent to it; the user can set a real address from their
 *   profile.
 *
 * `linkAccount` is narrowed too: providers return extra fields at the token
 * endpoint (GitHub's `refresh_token_expires_in` is the usual one) and Prisma
 * rejects a create with a column it does not have.
 */
import crypto from "crypto";
import type { Adapter, AdapterAccount, AdapterUser } from "@auth/core/adapters";

/** Exactly the columns core's `Account` model has. */
const ACCOUNT_COLUMNS = [
    "userId",
    "type",
    "provider",
    "providerAccountId",
    "refresh_token",
    "access_token",
    "expires_at",
    "token_type",
    "scope",
    "id_token",
    "session_state",
] as const;

const USERNAME_MAX = 24;

/** The columns of core's `User` this adapter reads and writes. */
export interface CoreUserRow {
    id: string;
    email: string;
    username: string;
    avatar: string | null;
    emailVerified: Date | null;
}

/**
 * The slice of the Prisma client the adapter needs, so the mapping can be
 * tested without a database.
 */
export interface CoreAdapterClient {
    user: {
        create(args: { data: Record<string, unknown> }): Promise<CoreUserRow>;
        update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<CoreUserRow>;
        findFirst(args: { where: { username: { equals: string; mode: "insensitive" } }; select: { id: true } }): Promise<{ id: string } | null>;
    };
    account: {
        create(args: { data: Record<string, unknown> }): Promise<unknown>;
    };
}

/** An address that can never receive mail, unique per account. */
export function placeholderEmail(random: () => string = () => crypto.randomUUID()): string {
    return `no-email-${random().replace(/-/g, "").slice(0, 24)}@users.invalid`;
}

/** True for something that could plausibly be delivered to. */
function usableEmail(value: unknown): value is string {
    return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * A username seed from whatever the provider gave us. Display names are
 * free-form - emoji, spaces, non-Latin scripts - so this keeps only what a
 * username may contain and falls back to the local part of the email.
 */
export function baseUsername(name: unknown, email: string): string {
    const source = typeof name === "string" && name.trim() ? name : email.split("@")[0];
    const slug = source
        .normalize("NFKD")
        .replace(/[^\w.-]+/g, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^[_.-]+|[_.-]+$/g, "")
        .slice(0, USERNAME_MAX);
    return slug || `user_${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Presents a core user row the way Auth.js expects to receive one.
 *
 * Only these five fields, rather than the whole row: everything returned here
 * is handed around by Auth.js and ends up in its error reporting, and the row
 * carries a password hash, a ban reason and a lockout counter that have no
 * business travelling with a sign-in. The role is deliberately absent too -
 * the JWT callback reads it from the database on every refresh, so a copy here
 * would only be a stale one.
 */
export function toAdapterUser(row: unknown): AdapterUser | null {
    if (!row || typeof row !== "object") return null;
    const user = row as Partial<CoreUserRow>;
    if (typeof user.id !== "string") return null;
    return {
        id: user.id,
        email: user.email ?? "",
        emailVerified: user.emailVerified ?? null,
        name: user.username ?? null,
        image: user.avatar ?? null,
    } as AdapterUser;
}

/** Drops the fields a provider returned that core's `Account` has no column for. */
export function toAccountRow(account: Record<string, unknown>): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const column of ACCOUNT_COLUMNS) {
        if (account[column] !== undefined) row[column] = account[column];
    }
    return row;
}

/** Prisma's unique-constraint error, which is how a username race surfaces. */
function isUniqueViolation(error: unknown, field: string): boolean {
    if (!error || typeof error !== "object" || (error as { code?: unknown }).code !== "P2002") return false;
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
    return fields.some((name) => name.includes(field));
}

/**
 * Whether the name is somebody's already, however it is capitalised. The
 * unique key is exact, so it is the check, not the constraint, that keeps a
 * provider's "Admin" off the site's "admin".
 */
async function nameHeld(prisma: CoreAdapterClient, username: string): Promise<boolean> {
    const holder = await prisma.user.findFirst({
        where: { username: { equals: username, mode: "insensitive" } },
        select: { id: true },
    });
    return holder !== null;
}

/**
 * Creates the user, retrying the username until it is free.
 *
 * The pre-check is what keeps a name somebody holds under another
 * capitalisation off a new account. Two sign-ups with the same display name
 * can still collide between the check and the insert, and there the unique
 * constraint decides and a violation just means another try.
 */
async function createUserWithUsername(
    prisma: CoreAdapterClient,
    data: { email: string; username: string; avatar: string | null; emailVerified: Date | null },
): Promise<CoreUserRow> {
    const base = data.username.slice(0, USERNAME_MAX);
    let username = base;
    for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0 || (await nameHeld(prisma, username))) {
            username = `${base.slice(0, USERNAME_MAX - 9)}_${crypto.randomUUID().slice(0, 8)}`;
        }
        try {
            return await prisma.user.create({ data: { ...data, username } });
        } catch (error) {
            if (!isUniqueViolation(error, "username")) throw error;
        }
    }
    throw new Error("[auth] could not find a free username for a new account");
}

/**
 * Wraps the stock Prisma adapter so Auth.js and core agree on what a user is.
 *
 * `base` is passed in rather than constructed here so the mapping can be tested
 * against a fake, and so this file never has to import `@auth/prisma-adapter`
 * (which reaches for a full `PrismaClient`).
 */
export function coreAuthAdapter(base: Adapter, prisma: CoreAdapterClient): Adapter {
    const getSessionAndUser = base.getSessionAndUser?.bind(base);
    const map = <A extends unknown[]>(fn: ((...args: A) => unknown) | undefined) =>
        fn && (async (...args: A) => toAdapterUser(await fn(...args)));

    return {
        ...base,

        createUser: async (user) => {
            const email = usableEmail(user.email) ? user.email : placeholderEmail();
            const row = await createUserWithUsername(prisma, {
                email,
                username: baseUsername(user.name, email),
                avatar: typeof user.image === "string" ? user.image : null,
                // A placeholder address is not a verified one, whatever the
                // provider claimed about the address it did not give us.
                emailVerified: usableEmail(user.email) ? (user.emailVerified ?? null) : null,
            });
            return toAdapterUser(row) as AdapterUser;
        },

        /**
         * Auth.js updates a user after an email link or a session refresh. Only
         * the fields core actually stores are applied - notably not `name`,
         * because the username is the account's identity here and belongs to
         * whoever changed it last, not to the provider's current display name.
         */
        updateUser: async ({ id, ...changes }) => {
            const data: Record<string, unknown> = {};
            if (usableEmail(changes.email)) data.email = changes.email;
            if (changes.emailVerified !== undefined) data.emailVerified = changes.emailVerified;
            if (changes.image !== undefined) data.avatar = changes.image;
            const row = await prisma.user.update({ where: { id }, data });
            return toAdapterUser(row) as AdapterUser;
        },

        linkAccount: async (account) => {
            await prisma.account.create({ data: toAccountRow(account as unknown as Record<string, unknown>) });
            return account as AdapterAccount;
        },

        getUser: map(base.getUser),
        getUserByEmail: map(base.getUserByEmail),
        getUserByAccount: map(base.getUserByAccount),

        getSessionAndUser: getSessionAndUser
            ? async (sessionToken: string) => {
                  const result = await getSessionAndUser(sessionToken);
                  if (!result) return null;
                  return { session: result.session, user: toAdapterUser(result.user) as AdapterUser };
              }
            : undefined,
    };
}
