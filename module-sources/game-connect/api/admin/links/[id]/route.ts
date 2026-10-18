/**
 * DELETE /api/v1/game-connect/admin/links/[id] - unlink a game account.
 *
 * The member keeps their account and the player keeps theirs; the next
 * purchase made in game asks the player to link again.
 */
import { NextRequest, NextResponse } from "next/server";
import { logActivity, prisma, rateLimitForRole } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { requireManager } from "../../../../lib/admin";

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const manager = await requireManager(await auth());
    if (manager instanceof NextResponse) return manager;
    const limited = await rateLimitForRole(`game-connect-admin:${manager.userId}`, { maxRequests: 60, windowMs: 60_000 }, null);
    if (!limited.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    const { id } = await params;

    const link = await prisma.gameConnectLink.findUnique({ where: { id }, select: { name: true, userId: true } });
    if (!link) return NextResponse.json({ error: "Not found", code: "not_found" }, { status: 404 });
    await prisma.gameConnectLink.delete({ where: { id } });
    await logActivity({
        userId: manager.userId,
        action: "game-connect.link.removed",
        entity: "game-connect-link",
        entityId: id,
        metadata: { player: link.name, member: link.userId },
    }).catch(() => {});
    return NextResponse.json({ ok: true });
}
