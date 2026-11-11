/**
 * Answers `profile.linkedAccounts` on the games where a username is a player
 * name: the player a member is there, the one they linked with a code or else
 * the one with their name.
 *
 * Only those games, and nothing with the setting off: a profile showed no
 * game account of this module's before, and a site that has not chosen to
 * publish one does not start to. A game another module already answered for
 * is left to that answer, so a profile never lists one game twice.
 */
import { prisma } from "@/core/sdk/server";
import { accountsByName } from "../lib/names";
import { nameSettings } from "../lib/settings";

/**
 * An account a profile shows as proved.
 *
 * Stated here rather than taken from `HookHandlerFor<"profile.linkedAccounts">`:
 * that shape is declared by member-profiles, which this module does not depend
 * on, and a site without it still builds this file.
 */
interface LinkedAccount {
    provider: string;
    username: string | null;
    avatar: string | null;
}

const profileLinkedAccounts = async (current: LinkedAccount[], who?: { userId: string }): Promise<LinkedAccount[]> => {
    if (!who?.userId) return current;
    const settings = await nameSettings();
    if (settings.games.length === 0) return current;

    const links = await prisma.gameConnectLink.findMany({
        where: { userId: who.userId, platform: { in: settings.games } },
        select: { platform: true, name: true },
        take: settings.games.length,
    });
    const named = await accountsByName(settings, who.userId, new Set(links.map((link) => link.platform)));
    const answered = new Set((current ?? []).map((account) => account.provider.toLowerCase()));
    return [
        ...(current ?? []),
        ...[...links, ...named]
            .filter((account) => !answered.has(account.platform))
            .map((account) => ({ provider: account.platform, username: account.name, avatar: null })),
    ];
};

export default profileLinkedAccounts;
