import { NextRequest, NextResponse } from "next/server";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { suggestionUpdateSchema } from "../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/suggestions/[id] - one suggestion, for its own page.
 *
 * A board row links here, and so does the moderation queue, which has been
 * pointing at `/suggestions/<id>` since it was written. A private suggestion
 * is its author's and a moderator's; one waiting for review is the same.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
    const { id } = await params;
    const session = await auth();
    const moderator = session?.user?.id ? await hasPermission(session.user.id, "suggestions.manage") : false;

    // The reader's own vote travels with the row. Without it the page had no
    // way to know, so its button started off on every load and offered to
    // cast a vote that was already cast - which takes it away.
    const found = await prisma.suggestion.findUnique({
        where: { id },
        include: {
            author: { select: { id: true, username: true, avatar: true } },
            _count: { select: { comments: true } },
            votes: session?.user?.id
                ? { where: { userId: session.user.id }, select: { id: true }, take: 1 }
                : { where: { id: "" }, select: { id: true }, take: 0 },
        },
    });
    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // As a yes or a no. One person's vote id has no business on another's
    // screen the moment anything caches a response.
    const { votes, ...rest } = found;
    const suggestion = { ...rest, voted: votes.length > 0 };

    const mine = suggestion.authorId && suggestion.authorId === session?.user?.id;
    const readable = moderator || mine
        || (suggestion.visibility === "public" && suggestion.moderationState === "APPROVED");
    // The same answer either way: a suggestion nobody may read must not be
    // distinguishable from one that does not exist.
    if (!readable) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ suggestion });
}

// PATCH /api/v1/suggestions/[id] - Update status (admin) or content (author)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const suggestion = await prisma.suggestion.findUnique({ where: { id } });
    if (!suggestion) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const parsed = suggestionUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const fields = parsed.data;

    const adminCheck = await hasPermission(session.user.id, "suggestions.manage");
    const data: Record<string, unknown> = {};

    // Admin can change status
    if (adminCheck && fields.status) data.status = fields.status;
    // Author can edit content
    if (suggestion.authorId === session.user.id) {
        if (fields.title) data.title = fields.title;
        if (fields.content) data.content = fields.content;
    }

    if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: "No changes" }, { status: 400 });
    }

    // Snapshot the previous state before update
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision("suggestions.suggestion", id, suggestion, "update", session.user.id);

    const updated = await prisma.suggestion.update({ where: { id }, data });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("suggestions.suggestion.updated", updated);
    if (data.status && data.status !== suggestion.status) {
        await doActionAsync("suggestions.suggestion.statusChanged", {
            suggestion: updated,
            previousStatus: suggestion.status,
        });
    }

    return NextResponse.json({ suggestion: updated });
}

// DELETE /api/v1/suggestions/[id]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const suggestion = await prisma.suggestion.findUnique({ where: { id } });
    if (!suggestion) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Removing somebody else's suggestion is moderation. Deciding what state
    // the board says it is in - planned, done, refused - is running the board,
    // and a site hands those to different people.
    if (
        suggestion.authorId !== session.user.id &&
        !(await hasPermission(session.user.id, "suggestions.moderate"))
    ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Snapshot the deleted suggestion for potential restore
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision("suggestions.suggestion", id, suggestion, "delete", session.user.id);

    await prisma.suggestion.delete({ where: { id } });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("suggestions.suggestion.deleted", suggestion);

    return NextResponse.json({ message: "Deleted" });
}
