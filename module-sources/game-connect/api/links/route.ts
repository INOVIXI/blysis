/**
 * GET    /api/v1/game-connect/links - the game accounts the signed-in member linked.
 * DELETE /api/v1/game-connect/links?id= - let one go.
 *
 * GET also names the players the member is by username (`byName`), which have
 * no link to let go, and whether a code is left to make (`codes`).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma, rateLimitForRole } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { accountsByName, codesOpen } from "../../lib/names";
import { nameSettings } from "../../lib/settings";

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
    const settings = await nameSettings();
    const [named, codes] = await Promise.all([
        accountsByName(settings, userId, new Set(links.map((link) => link.platform))),
        codesOpen(settings),
    ]);
    const byName = named.map((account) => ({ platform: account.platform, name: account.name }));
    return NextResponse.json({ links, byName, codes }, { headers: { "Cache-Control": "private, no-store" } });
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
