import { NextRequest } from "next/server";
import { apiError, apiSuccess, hasPermission, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

type RouteParams = { params: Promise<{ id: string }> };

// DELETE /api/v1/suggestions/comments/[id] - its author, or a moderator
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return apiError("Unauthorized", 401);

    const { id } = await params;
    const comment = await prisma.suggestionComment.findUnique({
        where: { id },
        select: { id: true, authorId: true, suggestionId: true },
    });
    if (!comment) return apiError("Not found", 404, { code: "not_found" });

    const moderator = await hasPermission(session.user.id, "suggestions.moderate");
    if (!moderator && comment.authorId !== session.user.id) return apiError("Forbidden", 403);

    await prisma.suggestionComment.delete({ where: { id } });

    return apiSuccess({ deleted: true });
}
