import { NextRequest, NextResponse } from "next/server";
import { readLinkedAccounts } from "../../lib/read-linked-accounts";
import { prisma } from "@/core/sdk/server";

type RouteParams = { params: Promise<{ username: string }> };

/**
 * A profile shows whatever the site has, and nothing it does not.
 *
 * Orders, forum topics and posts, blog comments and suggestions each belong to
 * another module, and this one depends on none of them: a profile is worth
 * having on a site with only a store, or only a forum. Prisma's generated
 * client carries a model only while the module that declares it is installed,
 * so asking for `_count: { topics: true }` outright makes the whole route a
 * compile error on every install without a forum, and asking through a
 * relation Prisma has never heard of is a runtime validation error rather than
 * a zero.
 *
 * Each optional total is therefore counted on its own model, and a model that
 * is not there counts zero.
 */
interface CountDelegate {
    count(args: { where: Record<string, unknown> }): Promise<number>;
}

/** One profile statistic, and the model that can answer it. */
const STATISTICS: ReadonlyArray<{ key: string; model: string; field: string }> = [
    { key: "orders", model: "order", field: "userId" },
    { key: "topics", model: "forumTopic", field: "authorId" },
    { key: "posts", model: "forumPost", field: "authorId" },
    { key: "comments", model: "blogComment", field: "authorId" },
    { key: "suggestions", model: "suggestion", field: "authorId" },
];

/**
 * Counts every statistic this install can answer.
 *
 * A statistic whose module is absent is left out entirely rather than reported
 * as zero: "0 topics" on a site with no forum is a wrong answer dressed as a
 * real one, and the page renders only the keys it is given.
 */
async function countStatistics(userId: string): Promise<Record<string, number>> {
    const available = STATISTICS.filter(
        (s) => (prisma as unknown as Record<string, unknown>)[s.model] !== undefined,
    );
    const counts = await Promise.all(
        available.map((s) =>
            ((prisma as unknown as Record<string, CountDelegate>)[s.model]).count({
                where: { [s.field]: userId },
            }),
        ),
    );
    return Object.fromEntries(available.map((s, i) => [s.key, counts[i]]));
}

interface RecentTopic {
    id: string;
    title: string;
    slug: string;
    createdAt: Date;
}

interface TopicDelegate {
    findMany(args: {
        where: Record<string, unknown>;
        select: Record<string, boolean>;
        orderBy: Record<string, "desc">;
        take: number;
    }): Promise<RecentTopic[]>;
}

async function recentForumTopics(userId: string): Promise<RecentTopic[]> {
    const delegate = (prisma as unknown as Record<string, unknown>).forumTopic;
    if (!delegate) return [];
    return (delegate as TopicDelegate).findMany({
        where: { authorId: userId },
        select: { id: true, title: true, slug: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5,
    });
}

// GET /api/v1/members/[username] - Public member profile
export async function GET(request: NextRequest, { params }: RouteParams) {
    const { username } = await params;

    const user = await prisma.user.findFirst({
        where: { username: { equals: username, mode: "insensitive" } },
        select: {
            id: true,
            username: true,
            avatar: true,
            createdAt: true,
            // The id and the declarations too: a screen drawing a role
            // without them draws the colour and silently ignores
            // whatever the operator actually wrote.
            role: { select: { id: true, name: true, displayName: true, color: true, nameCss: true, badgeCss: true } },
        },
    });

    if (!user) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    // The `_count` key is what the profile page has always read; a site with
    // every one of these modules gets exactly the object it got before.
    const [counts, recentTopics, linkedAccounts] = await Promise.all([
        countStatistics(user.id),
        recentForumTopics(user.id),
        // Asked for rather than read: the module that proved the account is
        // the only one that can say it is this member's, and this used to
        // publish whatever they had typed into a box. A picture still travels
        // with the identity where the answering module has one; the page used
        // to build one out of a linked name and a third party's URL.
        readLinkedAccounts(user.id),
    ]);

    return NextResponse.json({
        member: {
            ...user,
            _count: counts,
            recentTopics,
            linkedAccounts,
        },
    });
}
