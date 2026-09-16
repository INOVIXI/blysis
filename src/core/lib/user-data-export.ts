import { prisma } from "./db";
import { ModuleUserDataTables } from "@/core/generated/module-registry";
import { dashboardLayoutKey } from "./principal-rows";

/**
 * GDPR-compliant user data export.
 *
 * Collects everything the platform stores about a user - the core tables
 * listed in CORE_TABLES below, plus a sweep of module-owned tables declared
 * by each module's `userDataExport` manifest entry.
 *
 * Per the core motto, this file does NOT hardcode any module model names.
 * It reads the generated `ModuleUserDataTables` registry (aggregated from
 * every installed module's manifest at build time), then probes the
 * runtime Prisma client for each entry - uninstalled modules simply
 * contribute nothing to the export without raising errors.
 *
 * Every core table names the columns it hands out. Prisma returns every
 * column when a query names no `select`, so an export written as a bare
 * `findMany` ships whatever the schema keeps for itself: this one shipped
 * `UserSession.tokenId`, the claim a JWT carries and the key a session is
 * looked up by when it is checked for revocation. Listing the columns also
 * means a column added to one of these tables later is withheld until
 * someone puts it here on purpose.
 */

/** A core table copied into the export. */
interface CoreTable {
    /** Top-level key in the bundle, and in the README. */
    key: string;
    /** Prisma delegate name. */
    model: string;
    /** Column joining a row to the user. */
    column: string;
    /** The columns handed out, in schema order. */
    select: Record<string, true>;
    /**
     * Extra `where` clauses, for a table that holds more than this user's
     * rows under the same column. Only `ResourcePermission` needs it: its
     * `principalId` names a role just as often as a person.
     */
    where?: Record<string, unknown>;
}

export const CORE_TABLES: CoreTable[] = [
    {
        key: "activityFeed",
        model: "activityFeedItem",
        column: "actorId",
        select: { id: true, type: true, title: true, body: true, href: true, icon: true, isPublic: true, createdAt: true },
    },
    {
        key: "restrictions",
        model: "userRestriction",
        column: "userId",
        // Which parts of the site they were kept out of, why, and until when.
        // Theirs to have: it is a decision made about them, and the reason is
        // what they would ask about first.
        select: { id: true, scope: true, reason: true, expiresAt: true, createdAt: true },
    },
    {
        key: "timedRoles",
        model: "timedRoleGrant",
        column: "userId",
        // A role somebody paid to hold for a while, and when it lapses. Theirs
        // to have: it is a record of something they bought.
        select: { id: true, roleId: true, expiresAt: true, source: true, createdAt: true },
    },
    {
        // tokenId withheld: it is the live revocation key for the session.
        key: "sessions",
        model: "userSession",
        column: "userId",
        select: {
            id: true, deviceInfo: true, ipAddress: true, userAgent: true,
            lastActiveAt: true, createdAt: true, expiresAt: true, isRevoked: true,
        },
    },
    {
        // issuedById withheld: it names the moderator, who is a third party.
        key: "warnings",
        model: "userWarning",
        column: "userId",
        select: { id: true, reason: true, points: true, expiresAt: true, isActive: true, createdAt: true },
    },
    {
        key: "notificationPrefs",
        model: "notificationPreference",
        column: "userId",
        select: { id: true, eventType: true, channel: true, enabled: true, updatedAt: true },
    },
    {
        key: "revisions",
        model: "revision",
        column: "authorId",
        select: { id: true, resource: true, resourceId: true, data: true, action: true, createdAt: true },
    },
    {
        // The OAuth links. refresh_token, access_token, id_token and
        // session_state are live credentials for the provider account.
        key: "accounts",
        model: "account",
        column: "userId",
        select: {
            id: true, type: true, provider: true, providerAccountId: true,
            expires_at: true, token_type: true, scope: true,
        },
    },
    {
        // keyHash withheld: it is the verifier for the key itself.
        key: "apiKeys",
        model: "apiKey",
        column: "userId",
        select: {
            id: true, name: true, keyPrefix: true, permissions: true,
            lastUsedAt: true, expiresAt: true, isActive: true, createdAt: true,
        },
    },
    {
        // storagePath withheld: an internal bucket key, and `url` is the
        // same file addressed the way the user can actually fetch it.
        key: "media",
        model: "mediaItem",
        column: "uploadedById",
        select: {
            id: true, filename: true, url: true, mimeType: true, size: true,
            width: true, height: true, alt: true, createdAt: true,
        },
    },
    {
        key: "conversations",
        model: "conversationParticipant",
        column: "userId",
        select: { id: true, conversationId: true, joinedAt: true, lastReadAt: true },
    },
    {
        // The user's own messages only. The other side of a thread is the
        // other participant's data, not theirs to download.
        key: "messages",
        model: "message",
        column: "authorId",
        select: { id: true, conversationId: true, body: true, createdAt: true },
    },
    {
        // metadata withheld: an admin action records the account it acted on
        // (`targetUsername`, ban reasons), so the column carries other
        // people's data. What the user did, and to which entity, does not.
        key: "auditLog",
        model: "activityLog",
        column: "userId",
        select: { id: true, action: true, entity: true, entityId: true, ipAddress: true, createdAt: true },
    },
    {
        // principalType and principalId withheld: both are constant for
        // these rows - "user", and the id already at the top of the bundle.
        key: "resourcePermissions",
        model: "resourcePermission",
        column: "principalId",
        where: { principalType: "user" },
        select: { id: true, resource: true, resourceId: true, action: true, allow: true, createdAt: true },
    },
];

/**
 * Core tables holding a User relation that the export leaves out, and why.
 * A model added to the schema with a user column has to be exported or
 * listed here; the gate test reads this map.
 */
export const CORE_TABLES_WITHHELD: Record<string, string> = {
    // Auth.js runs the JWT strategy, so the adapter never writes this table,
    // and `sessionToken` is a bearer credential. The session list a user can
    // actually see is UserSession, which is exported above.
    Session: "unused under the JWT strategy, and sessionToken is a credential",
    // Site configuration an admin authored. `updatedById` records who last
    // saved a global theme value; it is not data about that person.
    ThemeCustomization: "site configuration, not personal data",
    ThemeSetting: "site configuration, not personal data",
};

/**
 * The bundle: the profile row, one key per entry in CORE_TABLES, and the
 * module sweep. The core keys are indexed rather than named one by one so
 * that CORE_TABLES stays the single place a table is declared.
 */
export interface UserDataExport {
    user: unknown;
    modules: Record<string, unknown>;
    [table: string]: unknown;
}

// Narrow helper - the generated Prisma client isn't fully typed for us
// because we look up models by string, so we use a minimal delegate shape
// and cast once at the boundary. No `any` leaks out of this module.
interface FindManyDelegate {
    findMany(args: { where: Record<string, unknown>; select?: Record<string, true> }): Promise<unknown[]>;
}

interface FindUniqueDelegate {
    findUnique(args: { where: Record<string, unknown>; select?: Record<string, true> }): Promise<unknown>;
}

function getDelegate(modelName: string): FindManyDelegate | null {
    const client = prisma as unknown as Record<string, unknown>;
    const delegate = client[modelName];
    if (
        delegate &&
        typeof delegate === "object" &&
        typeof (delegate as { findMany?: unknown }).findMany === "function"
    ) {
        return delegate as FindManyDelegate;
    }
    return null;
}

async function safeFindMany(
    modelName: string,
    where: Record<string, unknown>,
    select?: Record<string, true>
): Promise<unknown[]> {
    try {
        const delegate = getDelegate(modelName);
        if (!delegate) return [];
        return await delegate.findMany(select ? { where, select } : { where });
    } catch {
        return [];
    }
}

async function safeFindUnique(
    modelName: string,
    where: Record<string, unknown>,
    select: Record<string, true>
): Promise<unknown> {
    try {
        const client = prisma as unknown as Record<string, unknown>;
        const delegate = client[modelName];
        if (
            !delegate ||
            typeof delegate !== "object" ||
            typeof (delegate as { findUnique?: unknown }).findUnique !== "function"
        ) {
            return null;
        }
        return await (delegate as FindUniqueDelegate).findUnique({ where, select });
    } catch {
        return null;
    }
}

export async function exportUserData(userId: string): Promise<UserDataExport> {
    // Core user row - strip secret fields.
    const userRow = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            username: true,
            avatar: true,
            locale: true,
            currency: true,
            emailVerified: true,
            isBanned: true,
            banReason: true,
            bannedAt: true,
            isDeleted: true,
            deletedAt: true,
            createdAt: true,
            updatedAt: true,
            role: { select: { name: true, displayName: true } },
        },
    });

    const rows = await Promise.all(
        CORE_TABLES.map((table) =>
            safeFindMany(table.model, { [table.column]: userId, ...table.where }, table.select),
        ),
    );

    // The dashboard arrangement is one Setting row keyed by the user's id
    // rather than a table with a user column, so it is fetched on its own -
    // through the same delegate probe the tables use, because a client
    // without the model must yield nothing rather than throw.
    const layout = await safeFindUnique("setting", { key: dashboardLayoutKey(userId) }, {
        value: true,
        updatedAt: true,
    });

    const bundle: UserDataExport = { user: userRow, modules: {}, dashboardLayout: layout };
    CORE_TABLES.forEach((table, i) => {
        bundle[table.key] = rows[i];
    });

    const modules: Record<string, unknown> = {};
    for (const entry of ModuleUserDataTables) {
        const moduleRows = await safeFindMany(entry.model, { [entry.column]: userId });
        if (moduleRows.length > 0) {
            modules[entry.key] = moduleRows;
        }
    }
    bundle.modules = modules;

    return bundle;
}

/**
 * Human-readable README bundled alongside the JSON dump. Kept here so the
 * API route and the admin export share one canonical explanation.
 *
 * `siteName` is passed in rather than read here: this is the file a member
 * downloads about themselves, and it was headed with the product's name
 * instead of the name of the site they downloaded it from.
 */
export function buildExportReadme(userId: string, exportedAt: Date, siteName: string): string {
    const heading = `${siteName} personal data export`;
    return `${heading}
${"=".repeat(heading.length)}

User ID: ${userId}
Exported at: ${exportedAt.toISOString()}

Contents
--------
  user-data.json   Structured dump of every row in our database that
                   references your account, grouped by source:

  user             Your profile row (password hash and 2FA secrets
                   are intentionally omitted).
  activityFeed     Public activity feed entries you generated.
  restrictions     Parts of the site you were kept out of, why, and
                   until when.
  timedRoles       Roles you hold for a fixed period, and when each
                   one lapses.
  sessions         Login sessions (device, IP, last-active timestamp).
  warnings         Moderation warnings issued against you.
  notificationPrefs
                   Your per-channel notification preferences.
  revisions        Content revisions you authored.
  accounts         Sign-in providers linked to your account (provider
                   name and account id; the access tokens themselves
                   are omitted).
  apiKeys          API keys you created, by name and visible prefix.
                   The key itself is stored hashed and cannot be
                   handed back.
  media            Files you uploaded, with their public URLs.
  conversations    Direct-message threads you are a member of.
  messages         Direct messages you wrote. Replies from the other
                   side belong to their author and are not included.
  resourcePermissions
                   Per-account permission grants an admin recorded
                   against you, beyond what your role already allows.
  dashboardLayout  How you arranged the admin dashboard, if you are
                   an admin and ever changed it.
  auditLog         Security-relevant actions recorded against your
                   account, with the IP they came from. Details that
                   name another account are omitted.
  modules          Data owned by installed modules, grouped by module
                   (blog posts, forum topics, orders, tickets, votes,
                   linked game accounts, and so on). Only modules that
                   are currently installed on this instance contribute
                   data here.

Some rows are withheld on purpose: credentials that would still work
if they left our database, and fields that name somebody other than
you.

Your rights
-----------
Under GDPR and similar laws, you may also request permanent
anonymisation of your account ("right to be forgotten") from the
Privacy section of your profile page. That operation keeps your
public contributions (forum topics, blog posts, orders) but removes
your profile, sessions, and direct-message history.

Questions? Contact the site administrator.
`;
}
