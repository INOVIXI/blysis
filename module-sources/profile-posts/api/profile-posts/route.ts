import { NextRequest, NextResponse } from "next/server";
import { refuseSilenced, moduleSettings, pageParams, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { profilePostSchema, wallSettingSchema } from "../../lib/validations";
import { wallIsOpen } from "../../lib/wall";

/** How many replies a post shows before the reader asks for the rest. */
const REPLIES_SHOWN = 3;

const AUTHOR = { select: { id: true, username: true, avatar: true } } as const;

/**
 * GET /api/v1/profile-posts?profileUserId=...&page=1
 *
 * One member's wall, newest first, with the first few replies under each.
 *
 * Public, because a profile is. A wall its owner has shut answers with an
 * empty list and says so, rather than 403: the page has to draw something, and
 * "this member has turned profile posts off" is a different sentence from
 * "nothing here yet".
 */
export async function GET(request: NextRequest) {
    const profileUserId = (request.nextUrl.searchParams.get("profileUserId") ?? "").trim();
    if (!profileUserId) return NextResponse.json({ error: "Missing profileUserId" }, { status: 400 });

    const open = await wallIsOpen(profileUserId);
    if (!open) {
        return NextResponse.json({ posts: [], open: false, pagination: { page: 1, limit: 0, total: 0, pages: 1 } });
    }

    const { page, limit, skip, take } = pageParams(request.nextUrl.searchParams, { defaultLimit: 10, maxLimit: 30 });
    const where = { profileUserId };

    const [posts, total] = await Promise.all([
        prisma.profilePost.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take,
            select: {
                id: true,
                body: true,
                createdAt: true,
                authorId: true,
                author: AUTHOR,
                _count: { select: { replies: true } },
                replies: {
                    orderBy: { createdAt: "asc" },
                    take: REPLIES_SHOWN,
                    select: { id: true, body: true, createdAt: true, authorId: true, author: AUTHOR },
                },
            },
        }),
        prisma.profilePost.count({ where }),
    ]);

    return NextResponse.json({
        posts,
        open: true,
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
}

/**
 * POST /api/v1/profile-posts - write on somebody's wall.
 *
 * The author is the session and never the body: a route that took an author id
 * from the request would let anybody sign anybody's name.
 */
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // A mute on the record used to stop nothing. One call, so the next
    // endpoint somebody writes cannot quietly forget it; see write-guard.ts.
    const silenced = await refuseSilenced(session.user.id);
    if (silenced) return silenced;

    // Writing into somebody else's page, so this is throughput rather than a
    // brute-force ceiling: an operator's role multipliers apply.
    const rl = await rateLimitForRole(
        `profile-post:${session.user.id}`,
        { maxRequests: 20, windowMs: 15 * 60 * 1000 },
        session.user.role,
    );
    if (!rl.success) {
        return NextResponse.json({ error: "Too many posts. Try again later." }, { status: 429 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = profilePostSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid", code: "profile_post_empty" },
            { status: 400 },
        );
    }

    const text = parsed.data.body.trim();
    if (text === "") {
        return NextResponse.json({ error: "Write something first", code: "profile_post_empty" }, { status: 400 });
    }

    const { maxLength } = await moduleSettings<{ maxLength: number }>("profile-posts");
    if (typeof maxLength === "number" && text.length > maxLength) {
        return NextResponse.json({ error: "Too long", code: "profile_post_too_long" }, { status: 400 });
    }

    if (!(await wallIsOpen(parsed.data.profileUserId))) {
        return NextResponse.json({ error: "Wall is closed", code: "profile_wall_closed" }, { status: 403 });
    }

    const post = await prisma.profilePost.create({
        data: {
            profileUserId: parsed.data.profileUserId,
            authorId: session.user.id,
            body: text,
        },
        select: {
            id: true,
            body: true,
            createdAt: true,
            authorId: true,
            author: AUTHOR,
            _count: { select: { replies: true } },
            replies: { select: { id: true, body: true, createdAt: true, authorId: true, author: AUTHOR } },
        },
    });

    return NextResponse.json({ post }, { status: 201 });
}

/**
 * PATCH /api/v1/profile-posts - a member opens or shuts their own wall.
 *
 * Their own, and nobody else's: the id is the session's. `profileWallOpen`
 * had a reader (`wallIsOpen`) and no writer, which is a switch nailed to the
 * on position - the column existed, the page respected it, and there was no
 * way to move it.
 */
export async function PATCH(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // A switch is still a write somebody can hold down.
    const rl = await rateLimitForRole(
        `profile-wall-setting:${session.user.id}`,
        { maxRequests: 30, windowMs: 15 * 60 * 1000 },
        session.user.role,
    );
    if (!rl.success) {
        return NextResponse.json({ error: "Too many changes. Try again later." }, { status: 429 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = wallSettingSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
    }

    await prisma.user.update({
        where: { id: session.user.id },
        data: { profileWallOpen: parsed.data.open },
    });

    return NextResponse.json({ open: parsed.data.open });
}
