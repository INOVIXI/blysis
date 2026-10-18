/**
 * POST /api/v1/game-connect/status - who is on this server right now.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * in `authenticateServer` and by its process in `requireCurrentInstance`.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/core/sdk/server";
import { authenticateServer, refuse, requireCurrentInstance } from "../../lib/auth";
import { recordStatus } from "../../lib/presence";

const statusSchema = z.object({
    instance: z.string().min(8).max(64),
    online: z.number().int().min(0).max(1_000_000),
    max: z.number().int().min(0).max(1_000_000),
    players: z
        .array(z.object({ id: z.string().min(1).max(64).nullish(), name: z.string().min(1).max(64) }))
        .max(5000),
    version: z.string().max(64).nullish(),
    performance: z
        .object({ tps: z.number().min(0).max(1000).nullish(), mspt: z.number().min(0).max(100_000).nullish() })
        .nullish(),
});

export async function POST(request: NextRequest) {
    const server = await authenticateServer(request);
    if (server instanceof NextResponse) return server;

    const body = await readJsonBody(request, { maxBytes: 1_000_000 });
    if (body instanceof NextResponse) return body;
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) {
        return refuse(422, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid status");
    }
    const superseded = await requireCurrentInstance(server, parsed.data.instance);
    if (superseded) return superseded;

    const status = parsed.data;
    await recordStatus(server, {
        online: status.online,
        max: status.max,
        players: status.players.map((p) => ({ id: p.id ?? null, name: p.name })),
        version: status.version ?? null,
        performance: status.performance
            ? { tps: status.performance.tps ?? null, mspt: status.performance.mspt ?? null }
            : null,
    });
    return new NextResponse(null, { status: 204 });
}
