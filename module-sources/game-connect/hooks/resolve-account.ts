/**
 * Answers `game-account.resolve` from the links made here, so a module that
 * hears about a player finds the member whichever module linked the account.
 *
 * Only the account id is asked about, and only on the game the caller names:
 * an id is whatever a game server says it is, so the same string sent by a
 * server of another game must not find this game's member. A caller that
 * names no game is asking about any. Another answer stands: this one only
 * fills a blank. The shapes are spelled out
 * because the hook belongs to a module this one does not depend on.
 */
import { prisma } from "@/core/sdk/server";

interface GameAccountMatch {
    userId: string | null;
}

interface GameAccountLookup {
    username?: string | null;
    uuid?: string | null;
    platform?: string | null;
}

const resolveAccount = async (current: GameAccountMatch, lookup: GameAccountLookup): Promise<GameAccountMatch> => {
    if (current?.userId || !lookup?.uuid) return current ?? { userId: null };
    const link = await prisma.gameConnectLink.findFirst({
        where: lookup.platform ? { platform: lookup.platform, externalId: lookup.uuid } : { externalId: lookup.uuid },
        select: { userId: true },
        orderBy: { linkedAt: "asc" },
    });
    return link ? { userId: link.userId } : (current ?? { userId: null });
};

export default resolveAccount;
