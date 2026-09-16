/**
 * The permission names core owns.
 *
 * Core ships empty of features but not of administration: these four names
 * describe the admin panel itself, so they exist whether or not a single
 * module is installed. Every other permission name in the product is
 * contributed by a module's `permissions` manifest field and reaches the
 * roles screen through the module list.
 *
 * This file is a plain constant with no imports so both halves can read it:
 * `modules.ts` on the server and the roles screen in the browser. It used to
 * be written out twice, once in each, and a name added to one copy would
 * silently not appear in the other.
 *
 * A name listed here is offered as a checkbox on the roles screen and stored
 * as a `Permission` row when an operator ticks it. Whether anything then
 * *enforces* it is a separate question, pinned by
 * `tests/unit/permissions-are-declared.test.ts`.
 */
/**
 * Core's own vocabulary, with the words an operator reads.
 *
 * A name like `admin.moderation` is for the code. What the roles screen shows
 * is the label, in the reader's language, under a section heading - because a
 * permission list is read by somebody deciding what a job involves, not by
 * somebody who knows the codebase. A module supplies the same two things for
 * its own names through its manifest.
 */
export interface CorePermission {
    name: string;
    /** `namespace.key` in messages-core. */
    labelKey: string;
    /** Which heading it sits under on the roles screen. */
    section: "panel" | "people" | "content" | "system";
}

export const CORE_PERMISSION_CATALOGUE: CorePermission[] = [
    { name: "admin.access", labelKey: "permissions.adminAccess", section: "panel" },
    { name: "admin.settings", labelKey: "permissions.adminSettings", section: "panel" },
    // A payment key, a mail credential, a webhook secret: reading one is not
    // the same act as renaming the site, and the screens that hold them are
    // the ones a fraud starts from.
    { name: "admin.settings.credentials", labelKey: "permissions.adminSettingsCredentials", section: "panel" },
    { name: "admin.modules", labelKey: "permissions.adminModules", section: "panel" },
    // Installing a module is running somebody else's code on this site.
    // Turning an installed one on and off is not, and the second is a job an
    // operator hands out freely.
    { name: "admin.modules.install", labelKey: "permissions.adminModulesInstall", section: "panel" },
    { name: "admin.themes", labelKey: "permissions.adminThemes", section: "panel" },

    { name: "admin.users", labelKey: "permissions.adminUsers", section: "people" },
    // Held apart from editing a member, because they are different jobs with
    // different consequences. Deleting takes a person's account and everything
    // attached to it; signing in as somebody is doing things in their name,
    // which no audit trail can fully unpick afterwards. An operator who trusts
    // somebody to fix a display name has not thereby trusted them with either.
    { name: "admin.users.delete", labelKey: "permissions.adminUsersDelete", section: "people" },
    { name: "admin.users.impersonate", labelKey: "permissions.adminUsersImpersonate", section: "people" },
    { name: "admin.roles", labelKey: "permissions.adminRoles", section: "people" },
    { name: "admin.moderation", labelKey: "permissions.adminModeration", section: "people" },
    { name: "admin.messaging", labelKey: "permissions.adminMessaging", section: "people" },

    { name: "admin.content", labelKey: "permissions.adminContent", section: "content" },

    { name: "admin.observability", labelKey: "permissions.adminObservability", section: "system" },
    { name: "admin.security", labelKey: "permissions.adminSecurity", section: "system" },
    { name: "admin.backups", labelKey: "permissions.adminBackups", section: "system" },
    // Taking a copy is safe. Putting one back overwrites everything written
    // since it was taken, which is the only irreversible button in the panel.
    { name: "admin.backups.restore", labelKey: "permissions.adminBackupsRestore", section: "system" },
];

/** The names alone, which is what most callers want. */
export const CORE_PERMISSIONS = CORE_PERMISSION_CATALOGUE.map((entry) => entry.name);

/** A name in the one shape, as a type rather than a bare string. */
export type PermissionName = string & { readonly __permission?: never };

/**
 * The one shape a permission name may have: `namespace.action`.
 *
 * There used to be two vocabularies for one idea - a named flag on a role, and
 * a resource plus an action in another table, resolved by different code and
 * edited on different screens. A name is now the only vocabulary, and an
 * entity-level exception is this same name with an id beside it.
 *
 * Lower case throughout, because a name is compared as text and a case
 * difference would be two permissions that read as one. Hyphens are allowed
 * inside a segment: a module id carries them, and the namespace is the module
 * that owns the name.
 */
const PERMISSION_NAME = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export function isPermissionName(value: unknown): boolean {
    return typeof value === "string" && PERMISSION_NAME.test(value);
}

/** The module attributed to a permission name: the part before the first dot. */
export function permissionModule(name: string): string {
    return name.split(".")[0];
}
