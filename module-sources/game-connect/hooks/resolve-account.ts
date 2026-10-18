/**
 * Answers `game-account.resolve` from the links made here, so a module that
 * hears about a player finds the member whichever module linked the account.
 *
 * Only the account id is asked about. It is unique to its game's format, so
 * it cannot match a member of another game; a bare name could. Another
 * answer stands: this one only fills a blank. The shapes are spelled out
 * because the hook belongs to a module this one does not depend on.
 */
import { prisma } from "@/core/sdk/server";

interface GameAccountMatch {
    userId: string | null;
}

interface GameAccountLookup {
    username?: string | null;
    uuid?: string | null;
}

const resolveAccount = async (current: GameAccountMatch, lookup: GameAccountLookup): Promise<GameAccountMatch> => {
    if (current?.userId || !lookup?.uuid) return current ?? { userId: null };
    const link = await prisma.gameConnectLink.findFirst({
        where: { externalId: lookup.uuid },
        select: { userId: true },
        orderBy: { linkedAt: "asc" },
    });
    return link ? { userId: link.userId } : (current ?? { userId: null });
};

export default resolveAccount;
