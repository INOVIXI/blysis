import { NextRequest, NextResponse } from "next/server";
import { isAdmin, prisma, readJsonBody, rateLimitForRoleAsync } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { forumPostSchema } from "../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/v1/forum/posts/[id] - Edit post
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await rateLimitForRoleAsync(
        `forum-post-edit:${session.user.id}`,
        { maxRequests: 20, windowMs: 60_000 },
        session.user.role
    );
    if (!allowed) {
        return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });
    }

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    const post = await prisma.forumPost.findUnique({ where: { id } });
    if (!post) {
        return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.authorId !== session.user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // The create path parses forumPostSchema, so a reply is bounded at 50000
    // characters and cannot be empty. Editing has to hold the same line: without
    // it a post could be blanked by PATCHing nothing at all (an empty body turns
    // a missing body field into ""), or grown past any bound the create path has.
    const validation = forumPostSchema.pick({ content: true }).safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
    }

    // Snapshot the previous content before edit (subset - posts can be large)
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision(
        "forum.post",
        id,
        { content: post.content, topicId: post.topicId, authorId: post.authorId },
        "update",
        session.user.id
    );

    const updated = await prisma.forumPost.update({
        where: { id },
        data: { content: validation.data.content },
        include: { author: { select: { id: true, username: true, avatar: true } } },
    });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("forum.post.updated", updated);

    return NextResponse.json({ post: updated });
}

// DELETE /api/v1/forum/posts/[id]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const post = await prisma.forumPost.findUnique({ where: { id } });
    if (!post) {
        return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const adminCheck = await isAdmin(session.user.id);
    if (post.authorId !== session.user.id && !adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Snapshot the deleted post for potential restore (subset - posts can be large)
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision(
        "forum.post",
        id,
        { content: post.content, topicId: post.topicId, authorId: post.authorId, createdAt: post.createdAt },
        "delete",
        session.user.id
    );

    await prisma.forumPost.delete({ where: { id } });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("forum.post.deleted", post);

    return NextResponse.json({ message: "Post deleted" });
}
