/**
 * Things every connected server may want to say in game, in order.
 *
 * A cursor is the sequence number of the last event a server has seen. A
 * server that has just started asks without one and is handed the current
 * end, so it never replays a day of purchases into chat.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/sdk/server";
import { wake } from "./wake";

export type EventType = "purchase" | "topup" | "goal.reached" | "link.confirmed" | "catalog.changed";

export interface ProtocolEvent {
    id: string;
    type: string;
    at: string;
    data: unknown;
}

/** Events older than this are never sent and are swept. */
export const EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;
const EVENT_BATCH = 100;

export function cursorOf(seq: number): string {
    return `e-${seq}`;
}

export function seqOf(cursor: string | null | undefined): number | null {
    if (!cursor) return null;
    const match = /^e-(\d{1,15})$/.exec(cursor);
    return match ? Number(match[1]) : null;
}

export async function emitEvent(type: EventType, data: Record<string, unknown>, gameServerId: string | null = null): Promise<void> {
    await prisma.gameConnectEvent.create({
        data: { type, data: data as Prisma.InputJsonValue, gameServerId },
    });
    wake(gameServerId);
}

export async function latestCursor(): Promise<string> {
    const last = await prisma.gameConnectEvent.findFirst({ orderBy: { seq: "desc" }, select: { seq: true } });
    return cursorOf(last?.seq ?? 0);
}

/** The events after a cursor that this server should see, and the new cursor. */
export async function eventsAfter(
    gameServerId: string,
    cursor: string,
    now: Date = new Date(),
): Promise<{ events: ProtocolEvent[]; cursor: string }> {
    const after = seqOf(cursor) ?? 0;
    const rows = await prisma.gameConnectEvent.findMany({
        where: {
            seq: { gt: after },
            createdAt: { gte: new Date(now.getTime() - EVENT_RETENTION_MS) },
            OR: [{ gameServerId: null }, { gameServerId }],
        },
        orderBy: { seq: "asc" },
        take: EVENT_BATCH,
    });
    if (rows.length === 0) return { events: [], cursor: cursorOf(after) };
    return {
        events: rows.map((row) => ({ id: cursorOf(row.seq), type: row.type, at: row.createdAt.toISOString(), data: row.data })),
        cursor: cursorOf(rows[rows.length - 1].seq),
    };
}

/**
 * A goal announcement is kept past the month it names, because it is how the
 * next order of that month knows the goal was already said.
 */
const GOAL_RETENTION_MS = 40 * 24 * 60 * 60 * 1000;

export async function sweepEvents(now: Date = new Date()): Promise<number> {
    const result = await prisma.gameConnectEvent.deleteMany({
        where: {
            OR: [
                { type: { not: "goal.reached" }, createdAt: { lt: new Date(now.getTime() - EVENT_RETENTION_MS) } },
                { type: "goal.reached", createdAt: { lt: new Date(now.getTime() - GOAL_RETENTION_MS) } },
            ],
        },
    });
    return result.count;
}
