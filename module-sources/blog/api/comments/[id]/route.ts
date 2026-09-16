import { NextRequest, NextResponse } from "next/server";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { blogCommentModerationSchema } from "../../../lib/validations";

interface RouteParams {
    params: Promise<{ id: string }>;
}

// DELETE /api/v1/blog/comments/[id] - Delete a comment
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const comment = await prisma.blogComment.findUnique({
        where: { id },
    });

    if (!comment) {
        return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    // The person who wrote it, or somebody who moderates what members write.
    // Held apart from writing articles: the job of reading comments all day is
    // not the job of writing the blog, and a site usually gives them to
    // different people.
    if (
        comment.authorId !== session.user.id &&
        !(await hasPermission(session.user.id, "blog.moderate"))
    ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.blogComment.delete({ where: { id } });

    return NextResponse.json({ message: "Comment deleted successfully" });
}

// PATCH /api/v1/blog/comments/[id] - Update comment (admin: approve/reject)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await hasPermission(session.user.id, "blog.moderate"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const comment = await prisma.blogComment.findUnique({
        where: { id },
    });

    if (!comment) {
        return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = blogCommentModerationSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const { isApproved } = parsed.data;

    const updatedComment = await prisma.blogComment.update({
        where: { id },
        data: { isApproved },
        include: {
            author: {
                select: { id: true, username: true, avatar: true },
            },
        },
    });

    return NextResponse.json(updatedComment);
}
