/**
 * A member's username as their player name, on the games an operator names.
 *
 * Some sites share their accounts with the game: a player registers in game
 * and the site account carries the same name. A code proving the two are one
 * person proves nothing the name does not, so on those games a member counts
 * as linked to the player with their username, compared without case. No
 * link row is written: turning the setting off leaves the site as it was, and
 * the code flow comes back. A link a member made with a code still wins.
 *
 * Money and punishments follow the answer, so a name that could mean two
 * members means none, the rule `memberNamed` keeps.
 */
import crypto from "crypto";
import { prisma } from "@/core/sdk/server";
import type { NameSettings } from "./settings";

/**
 * The id an offline-mode Minecraft server gives a player: Java's
 * `UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(UTF_8))`, an MD5
 * name UUID of version 3. It reads the name as typed, so "Steve" and "steve"
 * are two ids; a member whose username differs in case from their name in
 * game is given an id the server does not use.
 */
export function offlineId(name: string): string {
    const hash = crypto.createHash("md5").update(`OfflinePlayer:${name}`, "utf8").digest();
    hash[6] = (hash[6] & 0x0f) | 0x30;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sameId(a: string, b: string): boolean {
    const plain = (id: string) => id.replace(/-/g, "").toLowerCase();
    return plain(a) === plain(b);
}

/** Whether a game names players by username. A caller that names no game asks about any. */
export function namesPlayers(settings: NameSettings, platform: string | null): boolean {
    return platform ? settings.games.includes(platform.toLowerCase()) : settings.games.length > 0;
}

/**
 * The one member a name means, or null: a player name through the links of a
 * game (of every game for null), or a site username, case ignored. Two links that still carry the
 * name, two usernames that differ only by case, or a link and a username of
 * different members are no answer.
 */
export async function memberByName(platform: string | null, name: string): Promise<string | null> {
    const [links, users] = await Promise.all([
        prisma.gameConnectLink.findMany({
            where: {
                ...(platform === null ? {} : { platform: platform.toLowerCase() }),
                name: { equals: name, mode: "insensitive" },
            },
            select: { userId: true },
            take: 2,
        }),
        prisma.user.findMany({
            where: { username: { equals: name, mode: "insensitive" } },
            select: { id: true },
            take: 2,
        }),
    ]);
    const candidates = new Set([...links.map((link) => link.userId), ...users.map((user) => user.id)]);
    if (candidates.size !== 1 || links.length > 1 || users.length > 1) return null;
    const [userId] = candidates;
    return userId;
}

/**
 * The member a player is by name alone, on a game that names players so.
 *
 * With offline-mode ids a player whose id is not the one their name derives
 * is somebody the server let in another way, a premium or a Bedrock account,
 * and their name is not evidence. An id the caller does not know is no
 * contradiction.
 */
export async function memberByPlayerName(
    settings: NameSettings,
    platform: string | null,
    player: { id: string | null; name: string },
): Promise<string | null> {
    const name = player.name.trim();
    if (name === "" || !namesPlayers(settings, platform)) return null;
    if (settings.offlineIds && player.id && !sameId(player.id, offlineId(name))) return null;
    return memberByName(platform, name);
}

export interface NamedAccount {
    platform: string;
    /** The offline-mode id with that setting on, else null: the site knows only the name. */
    externalId: string | null;
    name: string;
}

/**
 * The player a member is by username, on each named game where they have no
 * link: a link made with a code speaks for its game. Nothing where the
 * username could mean another member too.
 */
export async function accountsByName(
    settings: NameSettings,
    userId: string,
    linkedOn: ReadonlySet<string>,
): Promise<NamedAccount[]> {
    const games = settings.games.filter((game) => !linkedOn.has(game));
    if (games.length === 0) return [];
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    if (!user?.username) return [];
    const accounts: NamedAccount[] = [];
    for (const platform of games) {
        if ((await memberByName(platform, user.username)) !== userId) continue;
        accounts.push({ platform, externalId: settings.offlineIds ? offlineId(user.username) : null, name: user.username });
    }
    return accounts;
}

/**
 * Whether a code still has a game to link on: one connected server whose game
 * does not name players by username. A server that has not said hello has no
 * game yet and does not count.
 */
export async function codesOpen(settings: NameSettings): Promise<boolean> {
    if (settings.games.length === 0) return true;
    const servers = await prisma.gameConnectServer.findMany({ where: { enabled: true }, select: { game: true } });
    return servers.some((server) => server.game && !namesPlayers(settings, server.game));
}
