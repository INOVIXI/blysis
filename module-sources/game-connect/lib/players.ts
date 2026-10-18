/**
 * Which member a player in game is, and which player a name means.
 *
 * A link is evidence: a member proved the account with a code. The platform
 * is the server's game, so a Minecraft UUID and a SteamID can never meet.
 * Links made by the older Minecraft Link module count too: the first time
 * one is used here it is copied over, so nobody has to link twice.
 */
import { applyFiltersAsync } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";
import type { ConnectedServer } from "./auth";

export interface Player {
    id: string;
    name: string;
}

export interface LinkedMember {
    userId: string;
    username: string;
}

/** Empty only before hello, which no other call can come before. */
export function platformOf(server: Pick<ConnectedServer, "game">): string {
    return (server.game ?? "").toLowerCase();
}

/** The answer of the module that linked accounts before this one, spelled out: this module does not depend on it. */
interface GameAccountMatch {
    userId: string | null;
}

/**
 * The member behind a player, or null.
 *
 * The name is kept current on every lookup, so a rename in game shows on the
 * site the next time the player does anything.
 */
export async function memberOf(server: Pick<ConnectedServer, "game">, player: Player): Promise<LinkedMember | null> {
    const platform = platformOf(server);
    const link = await prisma.gameConnectLink.findUnique({
        where: { platform_externalId: { platform, externalId: player.id } },
    });
    let userId = link?.userId ?? null;

    // An account id is unique to its game's format, so asking with it cannot
    // find a member of another game.
    if (!link && platform !== "") {
        const older = await applyFiltersAsync("game-account.resolve", { userId: null } as GameAccountMatch, {
            uuid: player.id,
            username: null,
        });
        if (older?.userId) {
            userId = older.userId;
            await prisma.gameConnectLink
                .create({ data: { platform, externalId: player.id, name: player.name, userId } })
                .catch(() => undefined);
        }
    } else if (link && link.name !== player.name) {
        await prisma.gameConnectLink.update({ where: { id: link.id }, data: { name: player.name } }).catch(() => undefined);
    }
    if (!userId) return null;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
    return user ? { userId: user.id, username: user.username } : null;
}

/**
 * A member named by somebody in game: a player name first, through the
 * links, then a site username. Case does not matter for either.
 */
export async function memberNamed(server: Pick<ConnectedServer, "game">, name: string): Promise<LinkedMember | null> {
    const trimmed = name.trim();
    if (trimmed === "") return null;
    const link = await prisma.gameConnectLink.findFirst({
        where: { platform: platformOf(server), name: { equals: trimmed, mode: "insensitive" } },
        select: { userId: true },
    });
    const user = await prisma.user.findFirst({
        where: link ? { id: link.userId } : { username: { equals: trimmed, mode: "insensitive" } },
        select: { id: true, username: true },
    });
    return user ? { userId: user.id, username: user.username } : null;
}
