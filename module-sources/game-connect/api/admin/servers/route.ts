/**
 * GET  /api/v1/game-connect/admin/servers - every game server and how it is connected.
 * POST /api/v1/game-connect/admin/servers - give a game server a token, or a new one.
 *
 * The token is in the POST answer and nowhere else, ever: the site keeps its
 * hash. Making a new one for a server that had one revokes the old one in the
 * same write, so a leaked token stops working the moment it is replaced.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActivity, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { requireManager } from "../../../lib/admin";
import { listGameServers } from "../../../lib/servers";
import { issueToken } from "../../../lib/token";

const CONNECTED_FIELDS = {
    id: true,
    gameServerId: true,
    tokenHint: true,
    enabled: true,
    allowCreditAdmin: true,
    allowVoucherGive: true,
    instanceSeenAt: true,
    previousInstance: true,
    previousSeenAt: true,
    game: true,
    role: true,
    clientName: true,
    clientVersion: true,
    softwareName: true,
    softwareVersion: true,
    lastStatusAt: true,
    online: true,
    maxPlayers: true,
    version: true,
    tps: true,
    mspt: true,
} as const;

export async function GET() {
    const manager = await requireManager(await auth());
    if (manager instanceof NextResponse) return manager;

    const [servers, connected, waiting] = await Promise.all([
        listGameServers(),
        prisma.gameConnectServer.findMany({ select: CONNECTED_FIELDS, take: 500 }),
        prisma.gameConnectJob.groupBy({ by: ["gameServerId", "state"], _count: { _all: true } }),
    ]);
    const byServer = new Map(connected.map((row) => [row.gameServerId, row]));
    const counts = new Map<string, Record<string, number>>();
    for (const row of waiting) {
        const key = row.gameServerId ?? "current";
        const entry = counts.get(key) ?? {};
        entry[row.state] = row._count._all;
        counts.set(key, entry);
    }
    return NextResponse.json({
        servers: servers.map((server) => ({
            ...server,
            connection: byServer.get(server.id) ?? null,
            jobs: counts.get(server.id) ?? {},
        })),
        followPlayer: counts.get("current") ?? {},
    });
}

const issueSchema = z.object({ gameServerId: z.string().min(1).max(64) });

export async function POST(request: NextRequest) {
    const manager = await requireManager(await auth());
    if (manager instanceof NextResponse) return manager;
    const limited = await rateLimitForRole(`game-connect-admin:${manager.userId}`, { maxRequests: 60, windowMs: 60_000 }, null);
    if (!limited.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = issueSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Name a game server" }, { status: 400 });

    const known = (await listGameServers()).some((server) => server.id === parsed.data.gameServerId);
    if (!known) return NextResponse.json({ error: "No such game server", code: "not_found" }, { status: 404 });

    const issued = issueToken();
    await prisma.gameConnectServer.upsert({
        where: { gameServerId: parsed.data.gameServerId },
        create: { gameServerId: parsed.data.gameServerId, tokenHash: issued.hash, tokenHint: issued.hint },
        update: { tokenHash: issued.hash, tokenHint: issued.hint, instance: null, instanceSeenAt: null },
    });
    await logActivity({
        userId: manager.userId,
        action: "game-connect.token.issued",
        entity: "game-server",
        entityId: parsed.data.gameServerId,
        metadata: { hint: issued.hint },
    }).catch(() => {});

    return NextResponse.json({ token: issued.token, hint: issued.hint }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
