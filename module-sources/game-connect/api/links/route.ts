/**
 * GET    /api/v1/game-connect/links - the game accounts the signed-in member linked.
 * DELETE /api/v1/game-connect/links?id= - let one go.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma, rateLimitForRole } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

export async function GET() {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const links = await prisma.gameConnectLink.findMany({
        where: { userId },
        orderBy: { linkedAt: "asc" },
        select: { id: true, platform: true, name: true, linkedAt: true },
        take: 20,
    });
    return NextResponse.json({ links }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(request: NextRequest) {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const limited = await rateLimitForRole(`gc-unlink:${userId}`, { maxRequests: 10, windowMs: 60_000 }, session.user.role);
    if (!limited.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Name a link" }, { status: 400 });
    const removed = await prisma.gameConnectLink.deleteMany({ where: { id, userId } });
    if (removed.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
}
