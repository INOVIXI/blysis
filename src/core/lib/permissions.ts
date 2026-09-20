import { prisma } from "./db";
import { mayOpenAdminPath, type PanelReader } from "./admin-access";
import { STAFF_ROLE_PRIORITY } from "./constants";

/**
 * Permission system.
 *
 * A member holds a set of roles, and what they may do is the union of it.
 * Roles only ever grant, so two of them cannot disagree and nothing has to
 * arbitrate between them. The single role column a member used to have is
 * still there and means something narrower now: the role shown beside their
 * name, which is the highest-priority one they hold.
 *
 * Two layers, both bypassed by the admin role:
 *   1. The union of the held roles' permissions, e.g.
 *      hasPermission(userId, "blog.manage").
 *   2. ResourcePermission grants for per-resource or per-entity allow/deny,
 *      e.g. hasResourcePermission(userId, "blog.article", "edit", articleId).
 *
 * Resource grants resolve most-specific-first: user+resourceId → user+resource
 * → role+resourceId → role+resource → legacy role permissions. Any matching
 * deny short-circuits.
 */

/** What a member may do, worked out once from the roles they hold. */
export interface EffectiveRoles {
    /** Permission names granted by any unexpired role. Empty for an admin. */
    permissions: Set<string>;
    /** Holds a role named `admin`, which bypasses every check below. */
    isAdmin: boolean;
    /** The highest priority among the held roles, which is what staff means. */
    priority: number;
    /** Ids of the roles held, for the grants that are written against a role. */
    roleIds: string[];
}

const NOBODY: EffectiveRoles = { permissions: new Set(), isAdmin: false, priority: 0, roleIds: [] };

/**
 * The roles a member holds right now.
 *
 * An expired row grants nothing from the moment it expires rather than from
 * whenever the sweep next runs: a permission that outlives its expiry until a
 * cron happens to fire is not an expiry. The sweep still deletes the rows, so
 * this filter is the guarantee and the sweep is the tidying.
 */
async function resolveRoles(userId: string): Promise<EffectiveRoles> {
    if (!userId) return NOBODY;

    const held = await prisma.userRole.findMany({
        where: {
            userId,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: {
            roleId: true,
            expiresAt: true,
            role: {
                select: {
                    name: true,
                    priority: true,
                    rolePermissions: { select: { permission: true, state: true } },
                },
            },
        },
    });

    if (held.length === 0) return NOBODY;

    const allowed = new Set<string>();
    const refused = new Set<string>();
    let isAdmin = false;
    let priority = 0;
    const roleIds: string[] = [];

    const now = Date.now();
    for (const row of held) {
        const role = row.role;
        if (!role) continue;
        // Asked for in the query and checked again here. The query is what
        // keeps the read small; this is what makes the rule true, including
        // for a caller that hands in rows it fetched some other way, and it
        // costs one comparison per role.
        if (row.expiresAt && row.expiresAt.getTime() <= now) continue;
        if (typeof (row as { roleId?: string }).roleId === "string") roleIds.push((row as { roleId: string }).roleId);
        if (role.name === "admin") isAdmin = true;
        if (role.priority > priority) priority = role.priority;
        for (const entry of role.rolePermissions) {
            if (entry.state === "NEVER") refused.add(entry.permission);
            else allowed.add(entry.permission);
        }
    }

    // Never beats yes, from whichever role each came. Collected into two sets
    // first rather than decided row by row, because the database chooses the
    // order rows come back in and it must not choose this.
    for (const name of refused) allowed.delete(name);

    return { permissions: allowed, isAdmin, priority, roleIds };
}

/** The names a member may act on, as a set. An admin's set is empty and bypasses. */
export async function effectivePermissions(userId: string): Promise<Set<string>> {
    return (await resolveRoles(userId)).permissions;
}

/**
 * Both halves of the panel's question, from one read of the roles.
 *
 * The shell, the sidebar and the proxy each have to answer "may this person
 * open this" and they have to answer it the same way. Asking `isAdmin` and
 * `effectivePermissions` separately is two queries and two chances for the
 * answers to come from different moments.
 */
export async function panelReaderFor(userId: string | null | undefined): Promise<PanelReader> {
    if (!userId) return { isAdmin: false, permissions: new Set() };
    const held = await resolveRoles(userId);
    return { isAdmin: held.isAdmin, permissions: held.permissions };
}

/**
 * Whether this person may open this panel screen, for a page that knows its
 * own path.
 *
 * The proxy asks the same question of every panel request and is the reason a
 * screen is reachable at all. A page that guards itself as well is defence
 * against the day something reaches it another way, and it has to ask the
 * same question: several pages asked `isAdmin` instead, which is not what
 * opens them any more and refused everybody the roles screen had granted.
 */
export async function canOpenAdminPage(
    userId: string | null | undefined,
    pathname: string,
): Promise<boolean> {
    return mayOpenAdminPath(await panelReaderFor(userId), pathname);
}

export interface PermissionCheck {
    userId: string;
    permission: string;
}

export async function hasPermission(
    userId: string,
    permission: string
): Promise<boolean> {
    const held = await resolveRoles(userId);
    return held.isAdmin || held.permissions.has(permission);
}

/** True when the user has at least one of the listed permissions. */
export async function hasAnyPermission(
    userId: string,
    permissions: string[]
): Promise<boolean> {
    const held = await resolveRoles(userId);
    return held.isAdmin || permissions.some((permission) => held.permissions.has(permission));
}

/** True only when the user has every listed permission. */
export async function hasAllPermissions(
    userId: string,
    permissions: string[]
): Promise<boolean> {
    const held = await resolveRoles(userId);
    return held.isAdmin || permissions.every((permission) => held.permissions.has(permission));
}

/** Returns `["*"]` for admin (matches all permissions). */
export async function getUserPermissions(userId: string): Promise<string[]> {
    const held = await resolveRoles(userId);
    if (held.isAdmin) return ["*"];
    return [...held.permissions];
}

/** Adapter for API routes that gate on a single permission. */
export function requirePermission(permission: string) {
    return async (userId: string): Promise<{ allowed: boolean; error?: string }> => {
        const allowed = await hasPermission(userId, permission);
        if (!allowed) {
            return {
                allowed: false,
                error: `Permission denied: ${permission}`,
            };
        }
        return { allowed: true };
    };
}

/**
 * Pass sessionRole from the token to skip the query.
 *
 * The token carries the *displayed* role, which is the highest-priority one
 * held, so a member who holds the admin role holds it at the top: nothing
 * outranks it. The fast path is therefore still exact, and the slow path asks
 * the set rather than the column.
 */
export async function isAdmin(userId: string, sessionRole?: string): Promise<boolean> {
    if (sessionRole === "admin") return true;
    return (await resolveRoles(userId)).isAdmin;
}

/**
 * Staff = admin, or a role that has reached `STAFF_ROLE_PRIORITY`.
 *
 * The fast path used to accept the role *name* "moderator", which is not what
 * the database half of this function measures. Roles are the admin's to
 * rename and reorder, so a site that demoted its moderators saw the staff
 * links disappear from the navbar - that check reads the priority - while
 * every endpoint behind them kept saying yes, because the session still
 * carried the old name. Pass `sessionPriority` (the token carries it) to skip
 * the query; both paths now answer the same question.
 */
export async function isStaff(
    userId: string,
    sessionRole?: string,
    sessionPriority?: number,
): Promise<boolean> {
    if (sessionRole === "admin") return true;
    if (typeof sessionPriority === "number") return sessionPriority >= STAFF_ROLE_PRIORITY;

    const held = await resolveRoles(userId);
    return held.isAdmin || held.priority >= STAFF_ROLE_PRIORITY;
}

/* ─────────────────── Granular ResourcePermission ─────────────────── */

export type ResourceAction = "view" | "create" | "edit" | "delete" | string;

/**
 * Allow-by-rule check with most-specific-wins resolution; admins bypass.
 * Passing `resourceId` checks per-entity grants then falls back to
 * resource-wide. A deny at any matched level short-circuits to false.
 */
export async function hasResourcePermission(
    userId: string,
    resource: string,
    action: ResourceAction,
    resourceId?: string
): Promise<boolean> {
    const held = await resolveRoles(userId);
    if (held.roleIds.length === 0) return false;
    if (held.isAdmin) return true;

    const candidates: { principalType: string; principalId: string; resourceId: string | null }[] = [];

    if (resourceId) {
        candidates.push({ principalType: "user", principalId: userId, resourceId });
    }
    candidates.push({ principalType: "user", principalId: userId, resourceId: null });

    // Every role the member holds sits at the same level of specificity: none
    // of them is more theirs than another. A deny on any of them therefore
    // wins over an allow on another, which is the only safe reading - the
    // alternative is that granting somebody a second role can quietly lift a
    // refusal written against the first.
    if (resourceId) {
        for (const roleId of held.roleIds) {
            candidates.push({ principalType: "role", principalId: roleId, resourceId });
        }
    }
    for (const roleId of held.roleIds) {
        candidates.push({ principalType: "role", principalId: roleId, resourceId: null });
    }

    const grants = await prisma.resourcePermission.findMany({
        where: {
            resource,
            action: { in: [action, "*"] },
            OR: [
                { principalType: "user", principalId: userId },
                { principalType: "role", principalId: { in: held.roleIds } },
            ],
        },
    });

    if (grants.length === 0) return false;

    // Specificity runs along two axes, not one. The candidate list orders the
    // principal axis (this user for this entity, then this user, then their
    // role for this entity, then their role); the action axis is inside each
    // level, because the unique key includes `action` and so "edit" and "*"
    // are two rows on the same principal. Matching on principal alone let the
    // database's row order decide between them, so an operator who granted a
    // role everything and then took one action away had written a deny that
    // held or did not hold depending on which row came back first.
    type Grant = {
        principalType: string;
        principalId: string;
        resourceId: string | null;
        action: string;
        allow: boolean;
    };
    const levels: { principalType: string; resourceId: string | null }[] = [];
    for (const c of candidates) {
        if (!levels.some((l) => l.principalType === c.principalType && l.resourceId === c.resourceId)) {
            levels.push({ principalType: c.principalType, resourceId: c.resourceId });
        }
    }

    for (const level of levels) {
        const principals = candidates.filter(
            (c) => c.principalType === level.principalType && c.resourceId === level.resourceId,
        );
        const matches: Grant[] = [];
        for (const c of principals) {
            const atThisPrincipal = (grants as Grant[]).filter(
                (g) =>
                    g.principalType === c.principalType &&
                    g.principalId === c.principalId &&
                    g.resourceId === c.resourceId
            );
            const match =
                atThisPrincipal.find((g) => g.action === action) ??
                atThisPrincipal.find((g) => g.action === "*");
            if (match) matches.push(match);
        }
        if (matches.length === 0) continue;
        return matches.every((match) => match.allow);
    }
    return false;
}
