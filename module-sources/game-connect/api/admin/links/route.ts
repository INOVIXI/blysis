/**
 * GET /api/v1/game-connect/admin/links - every game account linked to a member.
 *
 * Searchable by the player's name or the member's username, because that is
 * what somebody asking for help quotes.
 */
import { NextRequest, NextResponse } from "next/server";
import { pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { requireManager } from "../../../lib/admin";

export async function GET(request: NextRequest) {
    const manager = await requireManager(await auth());
    if (manager instanceof NextResponse) return manager;

    const url = new URL(request.url);
    const { page, limit, skip } = pageParams(url.searchParams, { defaultLimit: 50 });
    const term = (url.searchParams.get("q") ?? "").trim().slice(0, 64);
    const members = term
        ? await prisma.user.findMany({
              where: { username: { contains: term, mode: "insensitive" } },
              select: { id: true },
              take: 50,
          })
        : [];
    const where = term
        ? {
              OR: [
                  { name: { contains: term, mode: "insensitive" as const } },
                  { userId: { in: members.map((member) => member.id) } },
              ],
          }
        : {};

    const [links, total] = await Promise.all([
        prisma.gameConnectLink.findMany({ where, orderBy: { linkedAt: "desc" }, skip, take: limit }),
        prisma.gameConnectLink.count({ where }),
    ]);
    const users = await prisma.user.findMany({
        where: { id: { in: links.map((link) => link.userId) } },
        select: { id: true, username: true },
        take: links.length,
    });
    const names = new Map(users.map((user) => [user.id, user.username]));

    return NextResponse.json({
        links: links.map((link) => ({
            id: link.id,
            platform: link.platform,
            externalId: link.externalId,
            name: link.name,
            member: names.get(link.userId) ?? null,
            linkedAt: link.linkedAt,
        })),
        total,
        page,
        limit,
    });
}
