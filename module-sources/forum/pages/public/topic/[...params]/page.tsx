/**
 * A topic, written by the server.
 *
 * The screen below is still a client component - replying, liking and paging
 * through replies are its job - but it used to fetch the topic on mount, so
 * none of a topic reached the HTML the server sent. Every one of the 58 topics
 * in the sitemap was an empty page to a reader without JavaScript and to
 * anything that indexes one.
 *
 * The rules about who may read a topic are in `readTopic`, which the endpoint
 * calls too. Written once, because a private section hidden by one caller and
 * not the other is worse than one nobody hid.
 */
import { notFound } from "next/navigation";
import { hasPermission } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { countTopicView, readTopic } from "../../../../lib/read-topic";
import { TopicView } from "../../../../components/TopicView";

interface PageProps {
    params: Promise<{ params?: string | string[]; slug?: string | string[] }>;
}

/** `/forum/topic/<id>/<slug>` - the id is what identifies it. */
function topicIdFrom(raw: string | string[] | undefined): string {
    const segments = typeof raw === "string" ? raw.split("/") : Array.isArray(raw) ? raw : [];
    const marker = segments.indexOf("topic");
    return marker >= 0 && segments[marker + 1] ? segments[marker + 1] : (segments[0] ?? "");
}

export default async function TopicPage({ params }: PageProps) {
    const resolved = await params;
    const id = topicIdFrom(resolved.params ?? resolved.slug);
    if (!id) notFound();

    const read = await readTopic(id, 1);
    // Null covers every refusal: a topic that is not there, a section this
    // reader may not see, a topic awaiting moderation. See readTopic.
    if (!read) notFound();

    await countTopicView(read.topic.id);

    // Dates cross the boundary as the strings the screen already expected of
    // the endpoint, so nothing below had to learn a second shape.
    const topic = {
        ...read.topic,
        createdAt: read.topic.createdAt.toISOString(),
        posts: read.topic.posts.map((post) => ({ ...post, createdAt: post.createdAt.toISOString() })),
    };

    /*
     * Whether this reader may work on anybody's reply, asked here because the
     * permission lives on the server. A reader's rights over their own reply
     * are decided in the screen - the author is the author - and both
     * endpoints check again, so this only decides which controls are drawn.
     */
    const session = await auth();
    const canModerate = session?.user?.id
        ? await hasPermission(session.user.id, "forum.edit-any")
        : false;

    return (
        <TopicView
            initialTopic={topic}
            initialPostsPages={read.postsPages}
            canModerate={canModerate}
        />
    );
}
