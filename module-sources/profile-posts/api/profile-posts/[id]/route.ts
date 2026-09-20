import { NextRequest, NextResponse } from "next/server";
import { refuseSilenced, hasPermission, moduleSettings, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { profileReplySchema } from "../../../lib/validations";
import { mayRemove, wallIsOpen } from "../../../lib/wall";

type RouteParams = { params: Promise<{ id: string }> };

const AUTHOR = { select: { id: true, username: true, avatar: true } } as const;

/** POST /api/v1/profile-posts/[id] - reply under one post. */
export async function POST(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // A mute on the record used to stop nothing. One call, so the next
    // endpoint somebody writes cannot quietly forget it; see write-guard.ts.
    const silenced = await refuseSilenced(session.user.id);
    if (silenced) return silenced;

    const rl = await rateLimitForRole(
        `profile-reply:${session.user.id}`,
        { maxRequests: 40, windowMs: 15 * 60 * 1000 },
        session.user.role,
    );
    if (!rl.success) {
        return NextResponse.json({ error: "Too many replies. Try again later." }, { status: 429 });
    }

    const { id } = await params;
    const post = await prisma.profilePost.findUnique({
        where: { id },
        select: { id: true, profileUserId: true },
    });
    if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // A shut wall refuses a reply as well as a post. Replying under a note on
    // a wall that has been closed is writing on that wall.
    if (!(await wallIsOpen(post.profileUserId))) {
        return NextResponse.json({ error: "Wall is closed", code: "profile_wall_closed" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = profileReplySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid", code: "profile_post_empty" }, { status: 400 });
    }
    const text = parsed.data.body.trim();
    if (text === "") {
        return NextResponse.json({ error: "Write something first", code: "profile_post_empty" }, { status: 400 });
    }

    const { maxLength } = await moduleSettings<{ maxLength: number }>("profile-posts");
    if (typeof maxLength === "number" && text.length > maxLength) {
        return NextResponse.json({ error: "Too long", code: "profile_post_too_long" }, { status: 400 });
    }

    const reply = await prisma.profilePostReply.create({
        data: { postId: post.id, authorId: session.user.id, body: text },
        select: { id: true, body: true, createdAt: true, authorId: true, author: AUTHOR },
    });

    return NextResponse.json({ reply }, { status: 201 });
}

/**
 * DELETE /api/v1/profile-posts/[id] - take a post down.
 *
 * Its author, the member whose wall it is on, or whoever moderates. The
 * replies go with it, by the foreign key.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const post = await prisma.profilePost.findUnique({
        where: { id },
        select: { id: true, authorId: true, profileUserId: true },
    });
    if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const moderates = await hasPermission(session.user.id, "profile-posts.moderate");
    if (!mayRemove(post, session.user.id, moderates)) {
        return NextResponse.json({ error: "Not yours", code: "profile_post_not_yours" }, { status: 403 });
    }

    await prisma.profilePost.delete({ where: { id: post.id } });
    return NextResponse.json({ ok: true });
}
