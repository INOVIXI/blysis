import { prisma } from "@/core/lib/db";

/**
 * Whether somebody else already answers to this name, compared the way a
 * reader compares it.
 *
 * The column's unique key is exact, so `Admin` and `admin` are two rows to
 * PostgreSQL and one name to everybody reading a forum post, a staff page or
 * an in-game chat line. Asking it exactly let a member register, or rename
 * themselves to, somebody else's name. `exceptUserId` is the account being
 * renamed, so a member may still recapitalise their own.
 * `tests/unit/a-username-belongs-to-one-person.test.ts` holds the routes to it.
 */
export async function usernameTaken(username: string, exceptUserId?: string): Promise<boolean> {
    const holder = await prisma.user.findFirst({
        where: {
            username: { equals: username, mode: "insensitive" },
            ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
        },
        select: { id: true },
    });
    return holder !== null;
}
