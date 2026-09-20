import { NextRequest, NextResponse } from "next/server";
import { refuseSilenced, isRestrictedFrom } from "@/core/sdk/server";
import { pageParams, hasPermission, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { forumPostSchema, forumTopicUpdateSchema } from "../../../lib/validations";
import { countTopicView, readTopic } from "../../../lib/read-topic";
import { accessToCategory } from "../../../lib/visible-categories";

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

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/v1/forum/topics/[id] - Get topic with posts
//
// The rules about who may read a topic live in lib/read-topic.ts, because the
// page renders the topic on the server now and the two must not disagree: a
// private section hidden by one and not the other is worse than one nobody
// hid. This endpoint is still what pages the replies and what the page asks
// again after somebody posts.
export async function GET(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;

    const { page: postsPage } = pageParams(request.nextUrl.searchParams, {
        pageParam: "postsPage",
        fixedLimit: 1,
    });

    const read = await readTopic(id, postsPage);
    if (!read) {
        return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }
    await countTopicView(read.topic.id);

    return NextResponse.json(read);
}

// POST /api/v1/forum/topics/[id] - Reply to topic
export async function POST(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // A mute on the record used to stop nothing. One call, so the next
    // endpoint somebody writes cannot quietly forget it; see write-guard.ts.
    const silenced = await refuseSilenced(session.user.id);
    if (silenced) return silenced;

    const rl = await rateLimitForRole(
        `forum-reply:${session.user.id}`,
        { maxRequests: 20, windowMs: 3_600_000 },
        session.user.role
    );
    if (!rl.success) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    // `topicId` comes from the path, not the body, so it is omitted here
    // rather than spread in: a body is `unknown` until a schema narrows it.
    const validation = forumPostSchema.omit({ topicId: true }).safeParse(body);

    if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
    }

    const topic = await prisma.forumTopic.findUnique({ where: { id } });
    if (!topic) {
        return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    /*
     * May this member post in the section the topic is in?
     *
     * This asked only whether the topic was locked. A private section was
     * hidden from the list and from the topic itself, and this endpoint would
     * still take a reply into it from anyone who had the id - which a member
     * who was once in that section, or anyone they told, has. Not found rather
     * than forbidden, for the reason the read gives: a 403 confirms that a
     * topic with that address exists.
     */
    const mayPost = await accessToCategory(topic.categoryId, session.user.role ?? null);
    if (!mayPost.view) {
        return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }
    if (!mayPost.reply) {
        return NextResponse.json({ error: "You cannot reply in this section" }, { status: 403 });
    }

    if (topic.isLocked) {
        return NextResponse.json({ error: "This topic is locked" }, { status: 403 });
    }

    const mode = await getModerationMode("forum_posts");
    const moderationState = mode === "manual" ? "PENDING" : "APPROVED";

    // Kept out of the forum without being kept off the site. Asked by this
    // module's own word: core stores the scope and never reads it.
    if (await isRestrictedFrom(session.user.id, "forum")) {
        return NextResponse.json(
            { error: "You cannot reply at the moment", code: "restricted_from_forum" },
            { status: 403 },
        );
    }

    const post = await prisma.forumPost.create({
        data: {
            content: validation.data.content,
            topicId: id,
            authorId: session.user.id,
            moderationState,
        },
        include: {
            author: { select: { id: true, username: true, avatar: true } },
        },
    });

    // Fire hook for cross-module reactions
    const { doActionAsync } = await import("@/core/sdk");
    // The topic travels with the reply: a listener that wants to tell the
    // topic's author about it should not have to read the forum's tables.
    await doActionAsync("forum.post.created", {
        ...post,
        topicAuthorId: topic.authorId,
        topicTitle: topic.title,
        topicSlug: topic.slug,
    });

    // Public activity feed entry
    await prisma.activityFeedItem.create({
        data: {
            type: "forum.post.created",
            actorId: session.user.id,
            title: `Replied to: ${topic.title}`,
            href: `/forum/topic/${topic.slug || topic.id}`,
            icon: "MessageCircle",
            isPublic: true,
        },
    }).catch(() => {});

    return NextResponse.json({ post }, { status: 201 });
}

// PATCH /api/v1/forum/topics/[id] - Update topic (admin: pin/lock)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    const topic = await prisma.forumTopic.findUnique({ where: { id } });
    if (!topic) {
        return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    // Three jobs, three answers. Editing your own topic is not a permission -
    // the author is the author - while editing somebody else's and pinning or
    // locking are two different things an operator hands out separately.
    const isAuthor = topic.authorId === session.user.id;
    const [mayEditAny, mayModerate] = await Promise.all([
        hasPermission(session.user.id, "forum.edit-any"),
        hasPermission(session.user.id, "forum.moderate"),
    ]);

    if (!isAuthor && !mayEditAny && !mayModerate) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsedPatch = forumTopicUpdateSchema.safeParse(body);
    if (!parsedPatch.success) {
        return NextResponse.json({ error: parsedPatch.error.issues[0].message }, { status: 400 });
    }
    const fields = parsedPatch.data;

    const data: Record<string, unknown> = {};
    const mayEditThis = isAuthor || mayEditAny;
    if (mayEditThis && fields.title) data.title = fields.title;
    if (mayEditThis && fields.content) data.content = fields.content;
    if (mayModerate && fields.isPinned !== undefined) data.isPinned = fields.isPinned;
    if (mayModerate && fields.isLocked !== undefined) data.isLocked = fields.isLocked;
    // Hiding is a moderator's, like the pins: it decides what every visitor
    // sees rather than what one topic says.
    if (mayModerate && fields.moderationState !== undefined) data.moderationState = fields.moderationState;

    // Only snapshot on content-meaningful edits (title / content), not pin/lock toggles
    if (data.title !== undefined || data.content !== undefined) {
        const { recordRevision } = await import("@/core/sdk/server");
        await recordRevision("forum.topic", id, topic, "update", session.user.id);
    }

    const updated = await prisma.forumTopic.update({
        where: { id },
        data,
    });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("forum.topic.updated", updated);

    return NextResponse.json({ topic: updated });
}

// DELETE /api/v1/forum/topics/[id]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const topic = await prisma.forumTopic.findUnique({ where: { id } });
    if (!topic) {
        return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    if (
        topic.authorId !== session.user.id &&
        !(await hasPermission(session.user.id, "forum.delete-any"))
    ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Snapshot the deleted topic for potential restore
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision("forum.topic", id, topic, "delete", session.user.id);

    await prisma.forumTopic.delete({ where: { id } });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("forum.topic.deleted", topic);

    return NextResponse.json({ message: "Topic deleted" });
}
