import { prisma } from "@/core/sdk/server";

/**
 * Whether a wall is open, and to whom.
 *
 * Three different answers hide behind one question. A wall a member has shut
 * is shut to everybody including them - that is what they asked for. A wall
 * that is open still refuses somebody who is not signed in, because a note
 * with no author on it is not a note. And whoever may moderate can always take
 * a post down, which is a different permission from writing one.
 *
 * The first of those is a column on the member, so it survives the module
 * being turned off and on again.
 */
export async function wallIsOpen(profileUserId: string): Promise<boolean> {
    const owner = await prisma.user.findUnique({
        where: { id: profileUserId },
        select: { profileWallOpen: true },
    });
    // A member who predates the column, or one that has since gone: absent is
    // not "shut", it is "never said", and the default is open.
    return owner ? owner.profileWallOpen !== false : false;
}

/**
 * Who may take a post down.
 *
 * Its author, because it is theirs; the member whose wall it is on, because it
 * is addressed to them and a wall you cannot clear is not yours; and whoever
 * holds the moderation permission.
 */
export function mayRemove(
    post: { authorId: string; profileUserId: string },
    viewerId: string,
    moderates: boolean,
): boolean {
    return moderates || post.authorId === viewerId || post.profileUserId === viewerId;
}
