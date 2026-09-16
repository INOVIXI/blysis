import { NextRequest, NextResponse } from "next/server";
import { hasPermission, prisma, readJsonBody, rateLimitForRoleAsync } from "@/core/sdk/server";
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

    // Editing your own post is not a permission - the author is the author.
    // Editing somebody else's is, and it is a different grant from removing
    // one: fixing a link in a member's post and deleting what they said are
    // not the same trust.
    if (
        post.authorId !== session.user.id &&
        !(await hasPermission(session.user.id, "forum.edit-any"))
    ) {
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

    // The author, or somebody the site trusts with anybody's posts. Deleting
    // and editing are held apart because they are: a typo fixed in somebody's
    // post is not the same act as removing what they said.
    if (
        post.authorId !== session.user.id &&
        !(await hasPermission(session.user.id, "forum.delete-any"))
    ) {
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
