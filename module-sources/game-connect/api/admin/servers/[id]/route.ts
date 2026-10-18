/**
 * PATCH  /api/v1/game-connect/admin/servers/[id] - switch a connection or its powers.
 * DELETE /api/v1/game-connect/admin/servers/[id] - revoke the token and forget the connection.
 *
 * `[id]` is the game server's id. Revoking leaves its queued deliveries where
 * they are: they go back to RCON's hands only if somebody sends them again.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActivity, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { requireManager } from "../../../../lib/admin";

type RouteParams = { params: Promise<{ id: string }> };

const patchSchema = z
    .object({
        enabled: z.boolean().optional(),
        allowCreditAdmin: z.boolean().optional(),
        allowVoucherGive: z.boolean().optional(),
    })
    .strict();

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const manager = await requireManager(await auth());
    if (manager instanceof NextResponse) return manager;
    const limited = await rateLimitForRole(`game-connect-admin:${manager.userId}`, { maxRequests: 60, windowMs: 60_000 }, null);
    if (!limited.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    const { id } = await params;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

    const changed = await prisma.gameConnectServer.updateMany({ where: { gameServerId: id }, data: parsed.data });
    if (changed.count === 0) return NextResponse.json({ error: "Not connected", code: "not_found" }, { status: 404 });
    await logActivity({
        userId: manager.userId,
        action: "game-connect.server.updated",
        entity: "game-server",
        entityId: id,
        metadata: parsed.data,
    }).catch(() => {});
    return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const manager = await requireManager(await auth());
    if (manager instanceof NextResponse) return manager;
    const limited = await rateLimitForRole(`game-connect-admin:${manager.userId}`, { maxRequests: 60, windowMs: 60_000 }, null);
    if (!limited.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    const { id } = await params;

    const removed = await prisma.gameConnectServer.deleteMany({ where: { gameServerId: id } });
    if (removed.count === 0) return NextResponse.json({ error: "Not connected", code: "not_found" }, { status: 404 });
    await prisma.gameConnectPresence.deleteMany({ where: { gameServerId: id } });
    await logActivity({
        userId: manager.userId,
        action: "game-connect.token.revoked",
        entity: "game-server",
        entityId: id,
    }).catch(() => {});
    return NextResponse.json({ ok: true });
}
