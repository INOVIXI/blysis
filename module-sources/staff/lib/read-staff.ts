/**
 * The team, read on the server.
 *
 * The page fetched them after it had loaded, so the HTML the server sent
 * carried no name and no role: measured, 59 characters of text inside
 * `<main>`. The endpoint calls this too, so who counts as staff and who counts
 * as online is decided once.
 */
import { prisma } from "@/core/sdk/server";

export async function readStaff(onlineOnly = false) {
    const members = await prisma.staffMember.findMany({
        where: { isActive: true },
        orderBy: { order: "asc" },
        take: 200,
        include: { user: { select: { id: true, username: true, avatar: true } } },
    });
    if (!onlineOnly) return members;

    /*
     * Staff with an unexpired, non-revoked session count as online.
     *
     * Asked of the users rather than of the sessions: a row is written per
     * sign-in and lives until its token expires, so reading every session of
     * every staff member to keep their ids grows with logins. `some` is an
     * existence check the database answers, and the result is one row per
     * staff member however often they signed in.
     */
    const linkedUserIds = members.map((m) => m.user?.id).filter((id): id is string => Boolean(id));
    if (linkedUserIds.length === 0) return [];

    const online = await prisma.user.findMany({
        where: {
            id: { in: linkedUserIds },
            loginSessions: { some: { isRevoked: false, expiresAt: { gt: new Date() } } },
        },
        select: { id: true },
    });
    const onlineIds = new Set(online.map((u) => u.id));
    return members.filter((m) => m.user?.id && onlineIds.has(m.user.id));
}
