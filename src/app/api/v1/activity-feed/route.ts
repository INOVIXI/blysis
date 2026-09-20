import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/core/lib/db";
import { getClientIP, rateLimitForRoleAsync } from "@/core/lib/rate-limit";
import { auth } from "@/core/lib/auth";
import { pageParams } from "@/core/lib/page-params";

/**
 * GET /api/v1/activity-feed
 * Public - returns recent isPublic feed items.
 * Query: ?limit=20&page=1&before=<iso-date>&userId=<id>&scope=mine&q=&type=
 *
 * When `scope=mine` is set AND the caller is authenticated, the response
 * includes the caller's private (isPublic=false) items as well, filtered
 * to actorId === session.user.id.
 *
 * Two ways through the same list. `before` is the cursor an infinite feed
 * walks; `page` is what a screen with a pager asks for. The member's own
 * activity tab was the caller that showed why both are needed: it asked for
 * fifty rows and drew every one of them, so an account with a year behind it
 * had no way to reach anything older, and no way to find one thing among the
 * fifty.
 *
 * `types` is the list of kinds present in whatever the filters leave, which
 * is what the filter control offers. It is a grouped count on an indexed
 * column, and the number of distinct kinds is the number of things modules
 * announce - tens, not thousands.
 *
 * Rate limited to 60 requests per minute by client IP.
 */
export async function GET(request: NextRequest) {
    const ip = getClientIP(request.headers);
    const allowed = await rateLimitForRoleAsync(
        `activity-feed:${ip}`,
        { maxRequests: 60, windowMs: 60_000 },
        null,
    );
    if (!allowed) {
        return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const { page, limit, skip } = pageParams(searchParams, { defaultLimit: 20, maxLimit: 50 });
    const before = searchParams.get("before");
    const userId = searchParams.get("userId");
    const scope = searchParams.get("scope");
    const term = (searchParams.get("q") ?? "").trim();
    const type = (searchParams.get("type") ?? "").trim();

    const where: {
        isPublic?: boolean;
        createdAt?: { lt: Date };
        actorId?: string;
        type?: string;
        OR?: { title?: object; body?: object }[];
    } = {};

    if (scope === "mine") {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        // Return both public and private items for the current user
        where.actorId = session.user.id;
    } else {
        where.isPublic = true;
        if (userId) where.actorId = userId;
    }

    if (before) {
        const d = new Date(before);
        if (!Number.isNaN(d.getTime())) where.createdAt = { lt: d };
    }

    if (type) where.type = type;

    // The headline and the excerpt are what a reader saw, so they are what a
    // reader searches. The kind is a dotted machine name and has its own
    // control; matching it here would make "store" find every order as well
    // as the word.
    if (term) {
        where.OR = [
            { title: { contains: term, mode: "insensitive" } },
            { body: { contains: term, mode: "insensitive" } },
        ];
    }

    // A cursor and a page are two answers to "where do I start", so a request
    // carrying `before` keeps the cursor's meaning and does not also skip.
    // `before` chooses between two numbers here and never becomes one.
    const skipRows = before ? 0 : skip;

    const [items, total, kinds] = await Promise.all([
        prisma.activityFeedItem.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: limit,
            skip: skipRows,
            include: {
                actor: { select: { id: true, username: true, avatar: true } },
            },
        }),
        prisma.activityFeedItem.count({ where }),
        prisma.activityFeedItem.groupBy({
            by: ["type"],
            // The kinds on offer do not narrow as the reader types: a filter
            // that empties its own list is a dead end nobody can back out of.
            where: { ...where, type: undefined, OR: undefined },
            _count: { _all: true },
            orderBy: { type: "asc" },
        }),
    ]);

    const nextCursor = items.length === limit ? items[items.length - 1].createdAt.toISOString() : null;

    return NextResponse.json({
        items,
        nextCursor,
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
        types: kinds.map((kind) => ({ type: kind.type, count: kind._count._all })),
    });
}
