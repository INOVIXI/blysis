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
export const CORE_PERMISSIONS = [
    /** The door itself, and the overview behind it. */
    "admin.access",
    /** Members: reading them, editing them, signing them out. */
    "admin.users",
    /** Roles, permissions and exceptions. Granting the power to grant. */
    "admin.roles",
    /** Acting on members: warnings, the queue, blocked addresses. */
    "admin.moderation",
    /** What the site says: media, translations, revisions. */
    "admin.content",
    /** Writing to the members. */
    "admin.messaging",
    /** How the site looks: themes, custom CSS, navbar, footer, widgets. */
    "admin.themes",
    /** How the site is configured. */
    "admin.settings",
    /** Installing and updating code. */
    "admin.modules",
    /** What the site is doing: analytics, health, logs, jobs. */
    "admin.observability",
    /** Credentials this site issues. */
    "admin.security",
    /** The copy of everything, and putting it back. */
    "admin.backups",
] as const;

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
