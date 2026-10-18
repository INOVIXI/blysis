/**
 * Who is on which server, as each server last said.
 *
 * A status push replaces the server's rows whole: the list it sends is the
 * truth for that moment, and a player who left is simply not in it. A player
 * counts as online for two status intervals after the last push, so a server
 * that stops reporting stops receiving deliveries that wait for its players.
 */
import { prisma } from "@/core/sdk/server";
import type { OnlinePlayers } from "./queue";
import { wake } from "./wake";

export interface StatusReport {
    online: number;
    max: number;
    players: { id: string | null; name: string }[];
    version: string | null;
    performance: { tps: number | null; mspt: number | null } | null;
}

export async function onlineOn(gameServerId: string, statusIntervalSeconds: number, now: Date = new Date()): Promise<OnlinePlayers> {
    const cutoff = new Date(now.getTime() - 2 * statusIntervalSeconds * 1000);
    const rows = await prisma.gameConnectPresence.findMany({
        where: { gameServerId, seenAt: { gte: cutoff } },
        select: { externalId: true, nameLower: true },
    });
    const ids = new Set<string>();
    const names = new Map<string, string | null>();
    for (const row of rows) {
        if (row.externalId) ids.add(row.externalId);
        names.set(row.nameLower, row.externalId);
    }
    return { ids, names };
}

export async function recordStatus(
    server: { id: string; gameServerId: string },
    status: StatusReport,
    now: Date = new Date(),
): Promise<void> {
    // One row per name: a client that sent a name twice should not count twice.
    const seen = new Map<string, { id: string | null; name: string }>();
    for (const player of status.players) seen.set(player.name.toLowerCase(), player);

    await prisma.$transaction([
        prisma.gameConnectPresence.deleteMany({ where: { gameServerId: server.gameServerId } }),
        prisma.gameConnectPresence.createMany({
            data: [...seen.entries()].map(([nameLower, player]) => ({
                gameServerId: server.gameServerId,
                externalId: player.id,
                name: player.name,
                nameLower,
                seenAt: now,
            })),
        }),
        prisma.gameConnectServer.update({
            where: { id: server.id },
            data: {
                lastStatusAt: now,
                online: Math.max(0, Math.trunc(status.online)),
                maxPlayers: Math.max(0, Math.trunc(status.max)),
                version: status.version,
                tps: status.performance?.tps ?? null,
                mspt: status.performance?.mspt ?? null,
            },
        }),
    ]);

    // A job that waited for one of these players may be eligible now, here or,
    // for a job aimed at the player's current server, nowhere else.
    if (seen.size > 0) wake(server.gameServerId);
}
