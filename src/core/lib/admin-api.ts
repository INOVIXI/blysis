/**
 * Which permission allows which write, for the endpoints core ships itself.
 *
 * Every one of these used to ask `isAdmin`, which is one bit of information:
 * administrator or not. With one bit, an operator cannot hand somebody the
 * moderation queue without also handing them the database backups, the
 * payment settings and the ability to install code. The name beside each route
 * is what makes delegation possible at all.
 *
 * A path here is the directory that reaches the route, dynamic segments
 * included, which is exactly what `a-mutation-says-who-may-make-it` reads off
 * disk. Keeping the two spellings identical is deliberate: a table that needed
 * translating into route patterns would drift from the routes it describes.
 *
 * GET is not listed. Reading is gated by the screen that does the reading -
 * an endpoint nobody can reach a screen for is not a leak, and gating every
 * read would double this table for no decision an operator would make
 * differently.
 */

import type { PermissionName } from "./permission-names";

export interface AdminApiRoute {
    /** Path below `/api`, matching the directory that holds the handler. */
    path: string;
    permission: PermissionName;
}

/** The catch-all that runs a module's endpoint; that module declared its own. */
export const API_DISPATCHER = "/v1/[...path]";

export const CORE_ADMIN_API: AdminApiRoute[] = [
    // Configuration of the installation.
    { path: "/v1/settings", permission: "admin.settings" },
    { path: "/v1/admin/maintenance", permission: "admin.settings" },
    { path: "/v1/admin/rate-limits", permission: "admin.settings" },
    { path: "/v1/admin/alerting", permission: "admin.settings" },
    { path: "/v1/admin/alerting/test", permission: "admin.settings" },

    // Members. Three permissions rather than one: editing a member is an
    // everyday job, deleting one takes their account and everything attached
    // to it, and signing in as somebody is doing things in their name.
    { path: "/v1/users", permission: "admin.users" },
    { path: "/v1/users/[id]", permission: "admin.users" },
    { path: "/v1/users/[id]/delete", permission: "admin.users.delete" },
    { path: "/v1/admin/impersonate/start", permission: "admin.users.impersonate" },
    { path: "/v1/admin/impersonate/stop", permission: "admin.users.impersonate" },

    // Acting on members.
    { path: "/v1/warnings", permission: "admin.moderation" },
    { path: "/v1/warnings/[id]", permission: "admin.moderation" },
    { path: "/v1/admin/warnings", permission: "admin.moderation" },
    { path: "/v1/admin/warnings/[id]", permission: "admin.moderation" },
    { path: "/v1/admin/moderation", permission: "admin.moderation" },
    { path: "/v1/admin/ip-blocks", permission: "admin.moderation" },
    { path: "/v1/admin/ip-blocks/[id]", permission: "admin.moderation" },
    { path: "/v1/admin/customers/[id]/restrictions", permission: "admin.moderation" },

    // Who may do what.
    { path: "/v1/roles", permission: "admin.roles" },
    { path: "/v1/roles/[id]", permission: "admin.roles" },
    { path: "/v1/admin/resource-permissions", permission: "admin.roles" },
    { path: "/v1/admin/resource-permissions/[id]", permission: "admin.roles" },

    // What the site says.
    { path: "/v1/media/[id]", permission: "admin.content" },
    { path: "/v1/upload", permission: "admin.content" },
    { path: "/v1/admin/translations", permission: "admin.content" },

    // Writing to the members.
    { path: "/v1/broadcasts", permission: "admin.messaging" },
    { path: "/v1/broadcasts/[id]", permission: "admin.messaging" },

    // How the site looks.
    { path: "/v1/themes/[id]", permission: "admin.themes" },
    { path: "/v1/themes/[id]/customization", permission: "admin.themes" },
    { path: "/v1/themes/[id]/settings/[group]", permission: "admin.themes" },
    { path: "/v1/themes/state", permission: "admin.themes" },
    { path: "/v1/themes/upload", permission: "admin.themes" },
    { path: "/v1/themes/marketplace/install", permission: "admin.themes" },

    // Installing code.
    { path: "/v1/modules", permission: "admin.modules" },
    { path: "/v1/modules/[id]", permission: "admin.modules.install" },
    { path: "/v1/modules/update", permission: "admin.modules" },
    { path: "/v1/modules/upload", permission: "admin.modules.install" },
    { path: "/v1/modules/marketplace/install", permission: "admin.modules.install" },
    { path: "/v1/modules/marketplace/bulk-install", permission: "admin.modules.install" },
    { path: "/v1/admin/updates", permission: "admin.modules" },

    // What the site is doing.
    { path: "/v1/admin/cron", permission: "admin.observability" },
    { path: "/v1/admin/cron/[key]/run", permission: "admin.observability" },
    { path: "/v1/admin/email-queue/[id]", permission: "admin.observability" },
    { path: "/v1/admin/email-queue/[id]/retry", permission: "admin.observability" },
    { path: "/v1/admin/email-queue/process", permission: "admin.observability" },

    // Credentials this site issues.
    { path: "/v1/api-keys", permission: "admin.security" },
    { path: "/v1/api-keys/[id]", permission: "admin.security" },

    // The copy of everything.
    { path: "/v1/admin/backup", permission: "admin.backups" },
    { path: "/v1/admin/backup/[id]", permission: "admin.backups" },
    { path: "/v1/admin/backup/[id]/restore", permission: "admin.backups.restore" },
];

export interface MemberMutation {
    path: string;
    /** Why no permission gates it. Read by a person, and checked for length. */
    reason: string;
}

/**
 * Writes a member makes about themselves, or that a machine makes about
 * itself. None of these is an operator's job, and gating them would mean
 * granting every member a permission, which is a permission that means
 * nothing.
 */
export const MEMBER_MUTATIONS: MemberMutation[] = [
    {
        path: "/v1/auth/register",
        reason: "Creating the account. There is nobody to hold a permission yet, and the rate limiter is what stands here instead.",
    },
    {
        path: "/v1/auth/forgot-password",
        reason: "Asking for a reset link, by somebody who by definition cannot sign in to prove anything about themselves.",
    },
    {
        path: "/v1/auth/reset-password",
        reason: "Spending a reset token. The token is the authorisation; a permission would have to be granted to everybody to be useful.",
    },
    {
        path: "/v1/auth/verify-email",
        reason: "Spending a verification token, which is the proof, and is checked by the handler before anything is written.",
    },
    {
        path: "/v1/auth/profile",
        reason: "A member editing their own profile. The handler writes to the signed-in id and no other, so there is no other account to reach.",
    },
    {
        path: "/v1/auth/profile/delete",
        reason: "A member erasing their own account, which is a right rather than a privilege and cannot be made to depend on a grant.",
    },
    {
        path: "/v1/users/me",
        reason: "The same member editing the same row, reached under a different name by the screens that were written later.",
    },
    {
        path: "/v1/me/avatar",
        reason: "A member's own picture. The operator's switch for this is a site setting, not a permission, because it applies to every member at once.",
    },
    {
        path: "/v1/sessions/[id]",
        reason: "Signing one of their own devices out. The handler refuses a session row belonging to anybody else.",
    },
    {
        path: "/v1/sessions/revoke-all",
        reason: "Signing all of their own devices out, which is what somebody does the moment they suspect a password has leaked.",
    },
    {
        path: "/v1/notification-preferences",
        reason: "What a member wants to be emailed about. Their own row, and refusing it would mean mail they cannot turn off.",
    },
    {
        path: "/v1/messages",
        reason: "A member writing to another member. Who may speak to whom is the messaging module's rule, not a panel permission.",
    },
    {
        path: "/v1/messages/[conversationId]",
        reason: "The same conversation, one message deeper. The handler proves the signed-in member is in it before writing.",
    },
    {
        path: "/v1/error-report",
        reason: "A browser reporting that a page broke. It is rate limited and stores no caller-supplied identity, and a gate here would hide exactly the failures it reports.",
    },
    {
        path: "/v1/webhook/[provider]",
        reason: "A payment provider posting to us with no browser and no session. The handler verifies the signature, which is the only authorisation that means anything here.",
    },
];
