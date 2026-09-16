/**
 * Which permission opens which screen in the panel.
 *
 * The panel used to have one gate - `isAdmin`, in the admin layout - and
 * nothing behind it. That is why a role with permissions could not be given
 * the panel: the door only knew one answer. A screen names what opens it here,
 * the proxy reads the same table, and the sidebar draws only what it would
 * open, so the three cannot drift.
 *
 * A path missing from this table is reachable by nobody but an admin. That is
 * the safe direction to fail, and `an-admin-screen-says-who-may-see-it` still
 * fails on it, because a screen nobody can reach is not a decision anybody
 * made on purpose.
 *
 * The names are coarse on purpose: eleven of them, each one a job an operator
 * would hand to somebody. A permission per screen would be a checklist of
 * forty-eight boxes that nobody reads before ticking them all.
 */

import type { PermissionName } from "./permission-names";

export interface AdminScreen {
    /** The path below `/admin` that reaches it, matching the directory. */
    path: string;
    permission: PermissionName;
}

/**
 * The catch-all that renders a module's admin page.
 *
 * It cannot carry a permission of its own: which page it draws depends on the
 * path, and the module that ships that page declared the permission in its
 * manifest.
 */
export const ADMIN_DISPATCHER = "/[...slug]";

export const CORE_ADMIN_SCREENS: AdminScreen[] = [
    { path: "/", permission: "admin.access" },

    // What the site is doing: read-heavy screens an operator watches.
    { path: "/analytics", permission: "admin.observability" },
    { path: "/observability", permission: "admin.observability" },
    { path: "/system", permission: "admin.observability" },
    { path: "/activity-log", permission: "admin.observability" },
    { path: "/audit-log", permission: "admin.observability" },
    { path: "/cron", permission: "admin.observability" },
    { path: "/email-queue", permission: "admin.observability" },
    { path: "/dev", permission: "admin.observability" },
    { path: "/api-docs", permission: "admin.observability" },

    // Writing to the members.
    { path: "/broadcasts", permission: "admin.messaging" },

    // What the site says: the words and pictures, not the design.
    { path: "/media", permission: "admin.content" },
    { path: "/translations", permission: "admin.content" },
    { path: "/revisions", permission: "admin.content" },

    // Acting on members, which is the job a moderator is given.
    { path: "/moderation", permission: "admin.moderation" },
    { path: "/warnings", permission: "admin.moderation" },
    { path: "/warnings/new", permission: "admin.moderation" },
    { path: "/ip-blocks", permission: "admin.moderation" },
    { path: "/ip-blocks/new", permission: "admin.moderation" },

    { path: "/users", permission: "admin.users" },
    { path: "/users/[id]", permission: "admin.users" },

    // Who may do what. Held apart from `admin.users` deliberately: editing a
    // member is an everyday job, and granting the permission to grant
    // permissions is not.
    { path: "/roles", permission: "admin.roles" },
    { path: "/roles/new", permission: "admin.roles" },
    { path: "/roles/[id]/edit", permission: "admin.roles" },
    { path: "/permissions", permission: "admin.roles" },
    { path: "/resource-permissions", permission: "admin.roles" },
    { path: "/resource-permissions/new", permission: "admin.roles" },

    { path: "/settings", permission: "admin.settings" },
    { path: "/settings/general", permission: "admin.settings" },
    { path: "/settings/site", permission: "admin.settings" },
    { path: "/settings/maintenance", permission: "admin.settings" },
    { path: "/settings/moderation", permission: "admin.settings" },
    { path: "/settings/rate-limits", permission: "admin.settings" },
    { path: "/settings/alerting", permission: "admin.settings" },

    // How the site looks. These live under `/settings` by history rather than
    // by kind, and the person who is trusted with the site's appearance is not
    // always the person trusted with its configuration.
    { path: "/settings/theme", permission: "admin.themes" },
    { path: "/settings/css", permission: "admin.themes" },
    { path: "/settings/navbar", permission: "admin.themes" },
    { path: "/settings/footer", permission: "admin.themes" },
    { path: "/settings/widgets", permission: "admin.themes" },
    { path: "/theme/appearance", permission: "admin.themes" },
    { path: "/theme/[group]", permission: "admin.themes" },

    // Installing code into the site.
    { path: "/modules", permission: "admin.modules" },
    { path: "/modules/[moduleId]", permission: "admin.modules" },
    { path: "/modules/updates", permission: "admin.modules" },
    { path: "/updates", permission: "admin.modules" },

    // Credentials, and the copy of everything.
    { path: "/api-keys", permission: "admin.security" },
    { path: "/api-keys/new", permission: "admin.security" },
    { path: "/backup", permission: "admin.backups" },
];
