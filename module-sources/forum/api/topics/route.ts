import { NextRequest, NextResponse } from "next/server";
import { isRestrictedFrom } from "@/core/sdk/server";
import { visibleCategoryIds } from "../../lib/visible-categories";
import { generateSlug } from "@/core/sdk";
import { pageParams, isAdmin, moduleSettings, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { forumTopicSchema } from "../../lib/validations";
import { denyGuestView } from "../../lib/guest-view";

type ModerationSettingValue = {
    blog_comments?: "auto" | "manual";
    forum_topics?: "auto" | "manual";
    forum_posts?: "auto" | "manual";
    suggestions?: "auto" | "manual";
};

async function getModerationMode(field: keyof ModerationSettingValue): Promise<"auto" | "manual"> {
    const setting = await prisma.setting.findUnique({ where: { key: "moderation" } });
    const value = (setting?.value ?? {}) as ModerationSettingValue;
    return value[field] === "manual" ? "manual" : "auto";
}

// GET /api/v1/forum/topics
export async function GET(request: NextRequest) {
    const denied = await denyGuestView();
    if (denied) return denied;

    const searchParams = request.nextUrl.searchParams;
    // The page size is the admin's `topicsPerPage`, not a constant. An explicit
    // ?limit= still wins for API callers, capped as before.
    const { topicsPerPage } = await moduleSettings<{ topicsPerPage: number }>("forum");
    const { page, limit, skip, take } = pageParams(searchParams, { defaultLimit: topicsPerPage });
    const categoryId = searchParams.get("category");
    const search = searchParams.get("search") || "";

    const session = await auth();
    const adminCheck = session?.user?.id ? await isAdmin(session.user.id) : false;

    const where: Record<string, unknown> = {};
    if (categoryId) where.categoryId = categoryId;
    if (search) where.title = { contains: search, mode: "insensitive" };
    if (!adminCheck) where.moderationState = "APPROVED";

    // Narrowed to what this reader may open. Without it a private section's
    // titles are listed by anyone who asks the endpoint directly, whatever the
    // page in front of it draws.
    const readable = await visibleCategoryIds(session?.user?.role ?? null);
    const onlyReadable = readable.everything
        ? where
        : { AND: [where, { categoryId: { in: readable.categoryIds } }] };

    const [topics, total] = await Promise.all([
        prisma.forumTopic.findMany({
            where: onlyReadable,
            include: {
                author: { select: { id: true, username: true, avatar: true } },
                category: { select: { id: true, name: true, slug: true, color: true } },
                _count: { select: { posts: true, likes: true } },
            },
            skip,
            take,
            orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
        }),
        prisma.forumTopic.count({ where: onlyReadable }),
    ]);

    return NextResponse.json({
        topics,
        total,
        pages: Math.ceil(total / limit),
        page,
    });
}

// POST /api/v1/forum/topics
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await rateLimitForRole(
        `forum-topic:${session.user.id}`,
        { maxRequests: 5, windowMs: 3_600_000 },
        session.user.role
    );
    if (!rl.success) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = forumTopicSchema.safeParse(body);

    if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
    }

    const { title, content, categoryId } = validation.data;
    let slug = generateSlug(title);

    // Deduplicate slug
    const existingSlug = await prisma.forumTopic.findUnique({ where: { slug } });
    if (existingSlug) {
        slug = `${slug}-${Date.now().toString(36)}`;
    }

    const mode = await getModerationMode("forum_topics");
    const moderationState = mode === "manual" ? "PENDING" : "APPROVED";

    // Kept out of the forum without being kept off the site. Asked by this
    // module's own word: core stores the scope and never reads it.
    if (await isRestrictedFrom(session.user.id, "forum")) {
        return NextResponse.json(
            { error: "You cannot post at the moment", code: "restricted_from_forum" },
            { status: 403 },
        );
    }

    const topic = await prisma.forumTopic.create({
        data: {
            title,
            slug,
            content: content,
            categoryId,
            authorId: session.user.id,
            moderationState,
        },
        include: {
            author: { select: { id: true, username: true, avatar: true } },
            category: { select: { id: true, name: true, slug: true } },
        },
    });

    // Discord notification

    // Fire hook for cross-module reactions
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("forum.topic.created", topic);

    // Public activity feed entry
    await prisma.activityFeedItem.create({
        data: {
            type: "forum.topic.created",
            actorId: session.user.id,
            title: `New topic: ${topic.title}`,
            href: `/forum/topic/${topic.slug || topic.id}`,
            icon: "MessageSquare",
            isPublic: true,
        },
    }).catch(() => {});

    return NextResponse.json({ topic }, { status: 201 });
}
