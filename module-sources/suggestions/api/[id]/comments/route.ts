import { NextRequest, NextResponse } from "next/server";
import { apiError, apiSuccess, isAdmin, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { suggestionCommentSchema } from "../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * The most comments one response carries. A discussion is readable by anyone
 * and grows with every reply, so reading all of it is a query with no
 * ceiling. `?limit=` asks for fewer.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** What a reader may see: approved comments, and their own pending ones. */
function visibleTo(userId: string | null, moderator: boolean) {
    if (moderator) return {};
    return userId
        ? { OR: [{ moderationState: "APPROVED" }, { authorId: userId }] }
        : { moderationState: "APPROVED" };
}

// GET /api/v1/suggestions/[id]/comments
export async function GET(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;
    const session = await auth();
    const moderator = session?.user?.id ? await isAdmin(session.user.id) : false;

    const requested = Number(new URL(request.url).searchParams.get("limit"));
    const limit = Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), MAX_LIMIT)
        : DEFAULT_LIMIT;

    const comments = await prisma.suggestionComment.findMany({
        where: { suggestionId: id, ...visibleTo(session?.user?.id ?? null, moderator) },
        orderBy: { createdAt: "asc" },
        take: limit + 1,
        include: { author: { select: { id: true, username: true, avatar: true } } },
    });

    // One past the ceiling, so the page can say it stopped rather than let a
    // reader believe a cut-off discussion is the whole of it.
    return apiSuccess({
        comments: comments.slice(0, limit),
        truncated: comments.length > limit,
    });
}

// POST /api/v1/suggestions/[id]/comments
export async function POST(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return apiError("Unauthorized", 401);

    const rl = await rateLimitForRole(
        `suggestion-comment:${session.user.id}`,
        { maxRequests: 10, windowMs: 60_000 },
        session.user.role,
    );
    if (!rl.success) return apiError("Too many requests", 429, { code: "rate_limited" });

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    const parsed = suggestionCommentSchema.safeParse(body);
    if (!parsed.success) return apiError(parsed.error.issues[0].message, 400, { code: "invalid_input" });

    const suggestion = await prisma.suggestion.findFirst({
        where: { id, moderationState: "APPROVED" },
        select: { id: true, title: true },
    });
    if (!suggestion) return apiError("Not found", 404, { code: "not_found" });

    // The same switch the suggestions themselves are held behind: an operator
    // who reviews suggestions has not asked to let replies through unread.
    const setting = await prisma.setting.findUnique({ where: { key: "moderation" } });
    const mode = (setting?.value as { suggestions?: "auto" | "manual" } | null)?.suggestions;

    const comment = await prisma.suggestionComment.create({
        data: {
            content: parsed.data.content,
            suggestionId: suggestion.id,
            authorId: session.user.id,
            moderationState: mode === "manual" ? "PENDING" : "APPROVED",
        },
        include: { author: { select: { id: true, username: true, avatar: true } } },
    });

    // The board's own feed entry, the way a new suggestion writes one.
    await prisma.activityFeedItem.create({
        data: {
            type: "suggestions.comment.created",
            actorId: session.user.id,
            title: `Commented on: ${suggestion.title}`,
            href: `/suggestions/${suggestion.id}`,
            icon: "MessageSquare",
            isPublic: true,
        },
    }).catch(() => { /* the comment is written; the feed is not worth losing it over */ });

    return apiSuccess({ comment }, 201);
}
