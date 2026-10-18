/**
 * Which member a player in game is, and which player a name means.
 *
 * A link is evidence: a member proved the account with a code. The platform
 * is the server's game, so a Minecraft UUID and a SteamID can never meet.
 * Links made by the older Minecraft Link module count too: the first time
 * one is used here it is copied over, so nobody has to link twice. It is asked
 * about this server's game only, so a link on one game never becomes a link
 * on another.
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

    if (!link && platform !== "") {
        const older = await applyFiltersAsync("game-account.resolve", { userId: null } as GameAccountMatch, {
            uuid: player.id,
            username: null,
            platform,
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
 * A member named by somebody in game: a player name through the links, or a
 * site username. Case does not matter for either.
 *
 * Money follows the answer, so a name that could mean two members means
 * none: two links that still carry one name (a rename the site has not seen
 * yet), or a player name and a username that belong to different members.
 * The caller then says it found nobody, and the sender names them another way.
 */
export async function memberNamed(server: Pick<ConnectedServer, "game">, name: string): Promise<LinkedMember | null> {
    const trimmed = name.trim();
    if (trimmed === "") return null;
    const [links, users] = await Promise.all([
        prisma.gameConnectLink.findMany({
            where: { platform: platformOf(server), name: { equals: trimmed, mode: "insensitive" } },
            select: { userId: true },
            take: 2,
        }),
        prisma.user.findMany({
            where: { username: { equals: trimmed, mode: "insensitive" } },
            select: { id: true },
            take: 2,
        }),
    ]);
    const candidates = new Set([...links.map((link) => link.userId), ...users.map((user) => user.id)]);
    if (candidates.size !== 1 || links.length > 1 || users.length > 1) return null;
    const [userId] = candidates;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true } });
    return user ? { userId: user.id, username: user.username } : null;
}
