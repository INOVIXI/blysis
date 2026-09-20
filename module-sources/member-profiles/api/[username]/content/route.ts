import { NextRequest, NextResponse } from "next/server";
import { pageParams, prisma } from "@/core/sdk/server";
import { CONTENT_KINDS, type ContentItem } from "../../../lib/member-content";

type RouteParams = { params: Promise<{ username: string }> };

/**
 * GET /api/v1/members/[username]/content?kind=topics&page=1
 *
 * What a member has written, by kind.
 *
 * The profile counted five totals and every one of them was a dead end: a
 * reader saw "12 orders, 1 comment" and had no way to any of it. The counts
 * are links now and this is where they lead.
 *
 * A kind whose module is not installed answers 404 rather than an empty list,
 * for the same reason the counts leave it out: "nothing here" and "this site
 * has no forum" are different answers.
 *
 * Only what is public. Orders are counted on a profile and are deliberately
 * not listable - a stranger reading somebody's shopping is not a feature - so
 * `orders` declares no listing and the card for it stays plain text.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
    const { username } = await params;
    const asked = (request.nextUrl.searchParams.get("kind") ?? "").trim();
    const kind = CONTENT_KINDS.find((k) => k.kind === asked);
    if (!kind) return NextResponse.json({ error: "Unknown kind" }, { status: 404 });

    const delegate = (prisma as unknown as Record<string, unknown>)[kind.model];
    if (!delegate) return NextResponse.json({ error: "Not available" }, { status: 404 });

    const user = await prisma.user.findFirst({
        where: { username: { equals: username, mode: "insensitive" } },
        select: { id: true, username: true },
    });
    if (!user) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    const { page, limit, skip, take } = pageParams(request.nextUrl.searchParams, { defaultLimit: 20, maxLimit: 50 });
    const where = { [kind.field]: user.id, ...(kind.where ?? {}) };

    const listing = delegate as {
        findMany(args: Record<string, unknown>): Promise<Record<string, unknown>[]>;
        count(args: { where: Record<string, unknown> }): Promise<number>;
    };

    const [rows, total] = await Promise.all([
        listing.findMany({ where, select: kind.select, orderBy: { createdAt: "desc" }, skip, take }),
        listing.count({ where }),
    ]);

    const items: ContentItem[] = rows.map((row) => kind.item(row));

    return NextResponse.json({
        member: { username: user.username },
        kind: kind.kind,
        items,
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
}
