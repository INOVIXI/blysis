/**
 * One topic and a page of its replies, with the rules about who may see it.
 *
 * The rules were inside the GET handler, and the page that shows a topic is a
 * client component that fetched it: so the topic's title, its opening post and
 * every reply reached the browser and never the HTML the server sent. A reader
 * without JavaScript, and anything that indexes one, got an empty page - for
 * all 58 topics the sitemap publishes.
 *
 * The page renders this on the server now, and the endpoint still exists for
 * paging and for after a reply. They call the same function rather than each
 * carrying a copy of the rules: a private section that is hidden by one and
 * not the other is worse than one nobody hid.
 *
 * Nothing here has a side effect. Counting a view is `countTopicView`, kept
 * apart for the reason in its own comment.
 */
import { headers } from "next/headers";
import { isAdmin, moduleSettings, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { accessToCategory, visibleCategoryIds } from "./visible-categories";
import { mayViewForum } from "./guest-view";

type FoundTopic = NonNullable<Awaited<ReturnType<typeof findTopic>>>;

/** A reply, plus whether the reader asking for it has already liked it. */
export type TopicPost = Omit<FoundTopic["posts"][number], "likes"> & { liked: boolean };

export interface TopicRead {
    topic: Omit<FoundTopic, "posts"> & { posts: TopicPost[] };
    postsPage: number;
    postsPerPage: number;
    postsTotal: number;
    postsPages: number;
}

/**
 * `readerId` narrows the likes joined to each reply to that reader's own, so
 * a reply arrives knowing whether the person reading it has liked it. It used
 * to arrive knowing only the total: the like button started off on every load
 * and the only thing that ever turned it on was the response to pressing it,
 * so coming back to a thread offered to like a reply that was already liked
 * and pressing it took the like away.
 *
 * The topic's own like was already read back, by a second request to
 * `/like`. One per reply would be one request per row; this is a join on the
 * unique constraint that already exists, and it costs the read nothing.
 */
function findTopic(
    id: string,
    postWhere: { moderationState: "APPROVED" } | undefined,
    skip: number,
    take: number,
    readerId: string | null,
) {
    return prisma.forumTopic.findFirst({
        where: { OR: [{ id }, { slug: id }, ...(isNaN(Number(id)) ? [] : [{ number: Number(id) }])] },
        include: {
            author: { select: { id: true, username: true, avatar: true } },
            category: { select: { id: true, name: true, slug: true, color: true } },
            posts: {
                where: postWhere,
                orderBy: { createdAt: "asc" },
                skip,
                take,
                include: {
                    author: { select: { id: true, username: true, avatar: true } },
                    _count: { select: { likes: true } },
                    likes: readerId
                        ? { where: { userId: readerId }, select: { id: true }, take: 1 }
                        : { where: { id: "" }, select: { id: true }, take: 0 },
                },
            },
            _count: { select: { likes: true } },
        },
    });
}

/**
 * Null covers every refusal on purpose. A 403 confirms that a topic with that
 * address exists, which is half of what a private section is hiding, so a
 * caller turns this into "not found" whatever the reason was.
 */
export async function readTopic(id: string, postsPage: number): Promise<TopicRead | null> {
    if (!(await mayViewForum())) return null;

    const reader = await auth();
    const readerIsAdmin = reader?.user?.id ? await isAdmin(reader.user.id) : false;

    const { postsPerPage } = await moduleSettings<{ postsPerPage: number }>("forum");
    const perPage = Math.max(1, Number(postsPerPage) || 20);
    const page = Math.max(1, Math.floor(postsPage) || 1);
    const postWhere = readerIsAdmin ? undefined : { moderationState: "APPROVED" as const };

    const found = await findTopic(id, postWhere, (page - 1) * perPage, perPage, reader?.user?.id ?? null);
    if (!found) return null;

    // The reader's own like leaves as a yes or a no. Handing back the row
    // that records it would put one person's like on another's screen the
    // moment anything caches a response.
    const topic = {
        ...found,
        posts: found.posts.map(({ likes, ...post }) => ({ ...post, liked: likes.length > 0 })),
    };
    if (!topic) return null;
    if (!(await accessToCategory(topic.categoryId, reader?.user?.role ?? null)).view) return null;
    if (!readerIsAdmin && topic.moderationState !== "APPROVED") return null;

    // Counted rather than taken from `_count`: a reader who is not an
    // administrator sees approved replies only, and a pager built from the raw
    // total offers them pages that render empty.
    const postsTotal = await prisma.forumPost.count({
        where: { topicId: topic.id, ...(postWhere ?? {}) },
    });

    return {
        topic,
        postsPage: page,
        postsPerPage: perPage,
        postsTotal,
        postsPages: Math.max(1, Math.ceil(postsTotal / perPage)),
    };
}

/**
 * One more view, unless nobody is looking yet.
 *
 * The count moved here with the read. It used to happen in the endpoint the
 * page called on mount, which fired once per reader; a server component runs
 * on the router's prefetch as well, and a hover over a link in the topic list
 * would otherwise count as a visit. Next says so in a header, so this asks.
 */
export async function countTopicView(topicId: string): Promise<void> {
    const prefetch = (await headers()).get("next-router-prefetch");
    if (prefetch) return;
    await prisma.forumTopic.update({ where: { id: topicId }, data: { views: { increment: 1 } } });
}

export interface TopicListRead {
    topics: Awaited<ReturnType<typeof listTopicRows>>;
    categories: { id: string; name: string; slug: string; color: string | null; icon: string | null; topicCount: number }[];
    page: number;
    pages: number;
    total: number;
}

function listTopicRows(where: Record<string, unknown>, skip: number, take: number) {
    return prisma.forumTopic.findMany({
        where,
        include: {
            author: { select: { id: true, username: true, avatar: true } },
            category: { select: { id: true, name: true, slug: true, color: true } },
            _count: { select: { posts: true, likes: true } },
        },
        skip,
        take,
        orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    });
}

/**
 * One page of topics, narrowed to what this reader may open.
 *
 * The board itself used to be fetched by the page after it had loaded, so the
 * HTML the server sent carried no link to a single topic: the 58 the sitemap
 * publishes had no path into them from anywhere on the site. Measured - the
 * board answered with 17 links, every one of them the shared header and
 * footer.
 *
 * Narrowing is the same rule the endpoint applies and lives in one place for
 * the same reason the single read does: a private section listed by one caller
 * and hidden by the other is worse than one nobody hid.
 */
export async function readTopicList(options: {
    page: number;
    categorySlug?: string;
    search?: string;
}): Promise<TopicListRead | null> {
    // Null here means "no such section", which the page answers with a 404.
    // Whether a guest may read the board at all is a different answer - a
    // sign-in prompt rather than a missing page - so the caller asks
    // `mayViewForum` for itself.
    const reader = await auth();
    const readerIsAdmin = reader?.user?.id ? await isAdmin(reader.user.id) : false;
    const { topicsPerPage } = await moduleSettings<{ topicsPerPage: number }>("forum");
    const perPage = Math.max(1, Number(topicsPerPage) || 20);
    const page = Math.max(1, Math.floor(options.page) || 1);

    const readable = await visibleCategoryIds(reader?.user?.role ?? null);
    const categories = await prisma.forumCategory.findMany({
        where: readable.everything ? {} : { id: { in: readable.categoryIds } },
        // `icon` holds a Lucide name. Printed straight it read as
        // "MessageSquare General" in the sidebar of every forum.
        select: { id: true, name: true, slug: true, color: true, icon: true, _count: { select: { topics: true } } },
        orderBy: { order: "asc" },
        take: 200,
    });

    const where: Record<string, unknown> = {};
    const chosen = options.categorySlug
        ? categories.find((category) => category.slug === options.categorySlug)
        : undefined;
    if (options.categorySlug && !chosen) return null;
    if (chosen) where.categoryId = chosen.id;
    if (options.search) where.title = { contains: options.search, mode: "insensitive" };
    if (!readerIsAdmin) where.moderationState = "APPROVED";

    const narrowed = readable.everything
        ? where
        : { AND: [where, { categoryId: { in: readable.categoryIds } }] };

    const [topics, total] = await Promise.all([
        listTopicRows(narrowed, (page - 1) * perPage, perPage),
        prisma.forumTopic.count({ where: narrowed }),
    ]);

    return {
        topics,
        categories: categories.map(({ _count, ...category }) => ({ ...category, topicCount: _count.topics })),
        page,
        pages: Math.max(1, Math.ceil(total / perPage)),
        total,
    };
}
