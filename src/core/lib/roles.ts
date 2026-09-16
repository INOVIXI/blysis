/**
 * Holding roles, and the one a member wears.
 *
 * A member holds a set. A badge can only draw one, and picking it at render
 * time is a join per row - fifty rows on the members screen, fifty joins - for
 * a value that changes when somebody is promoted and at no other time. So
 * `User.roleId` keeps its column and becomes a cache of the top of the set,
 * written here and nowhere else.
 *
 * Every writer of `UserRole` goes through this file for that reason: a grant
 * made by a module, a purchase, or an operator's form has to leave the cache
 * true, and a second writer that forgot would leave a member wearing a role
 * they no longer hold.
 */

import { prisma } from "./db";

/** The shape the pick needs: enough to rank a row, and nothing else. */
export interface HeldRole {
    roleId: string;
    grantedAt: Date;
    expiresAt: Date | null;
    role: { priority: number } | null;
}

/**
 * The role to show, out of the set.
 *
 * Priority is the number the site already sorts and styles roles by. A tie
 * goes to the one held longest, so a promotion changes the badge and a second
 * job at the same rank does not - which is the answer somebody would expect
 * without having to be told the rule.
 */
export function topRole(held: HeldRole[]): string | null {
    const now = Date.now();
    let best: HeldRole | null = null;

    for (const row of held) {
        if (!row.role) continue;
        if (row.expiresAt && row.expiresAt.getTime() <= now) continue;
        if (!best || !best.role) {
            best = row;
            continue;
        }
        if (row.role.priority > best.role.priority) {
            best = row;
            continue;
        }
        if (row.role.priority === best.role.priority && row.grantedAt < best.grantedAt) {
            best = row;
        }
    }

    return best?.roleId ?? null;
}

/**
 * Make the cache true again, and say what it now holds.
 *
 * Called after anything that changes the set. Returns the role written so a
 * caller that needs it does not read the row back.
 */
export async function syncDisplayedRole(userId: string): Promise<string | null> {
    const held = await prisma.userRole.findMany({
        where: { userId },
        select: {
            roleId: true,
            grantedAt: true,
            expiresAt: true,
            role: { select: { priority: true } },
        },
    });

    const roleId = topRole(held as HeldRole[]);
    await prisma.user.update({ where: { id: userId }, data: { roleId } });
    return roleId;
}

export interface GrantOptions {
    /** Null or absent is permanent. */
    expiresAt?: Date | null;
    /** A free label naming what granted it: a purchase, a campaign, an operator. */
    source?: string;
}

/**
 * Give a member a role, or extend the one they already hold.
 *
 * Extending rather than adding a second row is the point of the unique key:
 * buying the same rank twice should push the date out, not create a row that
 * lapses on the old date and takes the rank away while the other is still
 * live.
 *
 * A permanent grant never becomes temporary by accident: handing somebody a
 * timed rank they already hold permanently leaves it permanent.
 */
export async function grantRole(userId: string, roleId: string, options: GrantOptions = {}): Promise<void> {
    const expiresAt = options.expiresAt ?? null;
    const source = options.source ?? "manual";

    const existing = await prisma.userRole.findUnique({
        where: { userId_roleId: { userId, roleId } },
        select: { expiresAt: true },
    });

    if (existing) {
        const keepPermanent = existing.expiresAt === null;
        const extends_ = expiresAt !== null && existing.expiresAt !== null && expiresAt > existing.expiresAt;
        if (!keepPermanent && (expiresAt === null || extends_)) {
            await prisma.userRole.update({
                where: { userId_roleId: { userId, roleId } },
                data: { expiresAt, source },
            });
        }
    } else {
        await prisma.userRole.create({ data: { userId, roleId, expiresAt, source } });
    }

    await syncDisplayedRole(userId);
}

/** Take a role away. Silent when they did not hold it: the end state is the same. */
export async function revokeRole(userId: string, roleId: string): Promise<void> {
    await prisma.userRole.deleteMany({ where: { userId, roleId } });
    await syncDisplayedRole(userId);
}

/** Every role a member holds right now, newest grant first. */
export async function rolesHeldBy(userId: string): Promise<
    { roleId: string; expiresAt: Date | null; source: string }[]
> {
    const held = await prisma.userRole.findMany({
        where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: { roleId: true, expiresAt: true, source: true },
        orderBy: { grantedAt: "desc" },
    });
    return held;
}
