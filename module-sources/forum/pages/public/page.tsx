/**
 * The board, written by the server.
 *
 * It used to fetch its categories and its topics after the page had loaded, so
 * the HTML the server sent carried no link to a single topic: measured, the
 * board answered with 17 links and every one of them was the shared header and
 * footer. The 58 topics the sitemap publishes had no path into them from
 * anywhere on the site, and a reader without JavaScript saw an empty board.
 *
 * The section and the page number are addresses now rather than client state,
 * which is what lets a link to page two exist at all. `readTopicList` holds
 * the narrowing, and the endpoint applies the same rule.
 */
import { notFound } from "next/navigation";
import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/core/sdk/navigation";
import { PageFrame } from "@/core/sdk/layout";
import { Card, CardContent, Pagination, buttonClassName } from "@/core/sdk/ui";
import { NavIcon } from "@/core/sdk/ui";
import { Eye, Lock, MessageSquare, Pin, Plus, ThumbsUp } from "lucide-react";
import { formatDate, dateLocaleTag } from "@/core/sdk";
import { mayViewForum } from "../../lib/guest-view";
import { readTopicList } from "../../lib/read-topic";
import { TopicSearch } from "../../components/TopicSearch";

interface PageProps {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const one = (value: string | string[] | undefined): string | undefined => {
    const first = Array.isArray(value) ? value[0] : value;
    const trimmed = first?.trim();
    return trimmed ? trimmed : undefined;
};

/** `/forum`, with the section and the search kept in the query string. */
function forumHref(categorySlug?: string, search?: string): string {
    const query = new URLSearchParams();
    if (categorySlug) query.set("category", categorySlug);
    if (search) query.set("search", search);
    const qs = query.toString();
    return qs ? `/forum?${qs}` : "/forum";
}

export default async function ForumPage({ searchParams }: PageProps) {
    const query = (await searchParams) ?? {};
    const requested = Number.parseInt(one(query.page) ?? "", 10);
    const page = Number.isFinite(requested) && requested > 0 ? requested : 1;
    const categorySlug = one(query.category);
    const search = one(query.search);

    const t = await getTranslations("forum");

    // A closed forum is a sign-in prompt rather than a missing page: the
    // address is real, this reader may not read it yet.
    if (!(await mayViewForum())) {
        return (
            <PageFrame title={t("title")} description={t("communityDiscussions")}>
                <Card>
                    <CardContent className="py-12 text-center space-y-3">
                        <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                        <p className="text-muted-foreground">{t("guestViewDisabled")}</p>
                        <Link href="/auth/login" className="text-primary hover:underline text-sm">{t("signIn")}</Link>
                    </CardContent>
                </Card>
            </PageFrame>
        );
    }

    const board = await readTopicList({ page, categorySlug, search });
    // Null now means one thing: a section nobody has, or nobody may see.
    if (!board) notFound();

    const dateTag = dateLocaleTag(await getLocale());
    const active = categorySlug ? board.categories.find((c) => c.slug === categorySlug) : undefined;

    return (
        <PageFrame
            title={active?.name ?? t("title")}
            description={t("communityDiscussions")}
            trail={active ? [{ label: t("title"), href: "/forum" }] : []}
            actions={(
                <Link href="/forum/new" className={buttonClassName("default", "default")}>
                    <Plus className="w-4 h-4" aria-hidden="true" /> {t("newTopic")}
                </Link>
            )}
        >
            <div className="max-w-md">
                <TopicSearch initial={search ?? ""} categorySlug={categorySlug} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-1">
                    <Card>
                        <CardContent className="p-4">
                            <h2 className="font-semibold text-foreground mb-3">{t("categories")}</h2>
                            <div className="space-y-1">
                                {/* Links rather than buttons: a section is a
                                    place, and the board had no address for one. */}
                                <Link
                                    href={forumHref(undefined, search)}
                                    aria-current={!categorySlug ? "page" : undefined}
                                    className={`block px-3 py-2 rounded-lg text-sm transition-colors ${!categorySlug ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"}`}
                                >
                                    {t("allTopics")}
                                </Link>
                                {board.categories.map((category) => (
                                    <Link
                                        key={category.id}
                                        href={forumHref(category.slug, search)}
                                        aria-current={categorySlug === category.slug ? "page" : undefined}
                                        className={`px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between ${categorySlug === category.slug ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"}`}
                                    >
                                        <span className="flex items-center gap-2">
                                            <NavIcon name={category.icon} className="w-4 h-4" />
                                            {category.name}
                                        </span>
                                        <span className="text-xs text-muted-foreground">{category.topicCount}</span>
                                    </Link>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* `flex flex-col gap-4` rather than `space-y-4`: the rows are
                    <Link>s, anchors are inline, and a vertical margin on an
                    inline box does nothing. */}
                <div className="lg:col-span-4 min-w-0 flex flex-col gap-4">
                    {board.topics.length === 0 ? (
                        <Card>
                            <CardContent className="py-12 text-center">
                                <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                                <p className="text-muted-foreground mb-4">{t("noTopics")}</p>
                                <Link href="/forum/new" className={buttonClassName("default", "default")}>{t("createTopic")}</Link>
                            </CardContent>
                        </Card>
                    ) : (
                        <>
                            {board.topics.map((topic) => (
                                <Link key={topic.id} href={`/forum/topic/${topic.number}/${topic.slug}`}>
                                    <Card className="hover:shadow-md transition-shadow cursor-pointer">
                                        <CardContent className="p-4">
                                            <div className="flex items-start gap-4">
                                                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground font-bold text-sm flex-shrink-0">
                                                    {topic.author?.avatar ? (
                                                        <Image src={topic.author.avatar} alt="" width={40} height={40} className="w-full h-full rounded-full object-cover" />
                                                    ) : (
                                                        (topic.author?.username ?? t("deletedAuthor"))[0].toUpperCase()
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        {topic.isPinned && <Pin className="w-3 h-3 text-primary" aria-hidden="true" />}
                                                        {topic.isLocked && <Lock className="w-3 h-3 text-muted-foreground" aria-hidden="true" />}
                                                        <h2 className="font-medium text-foreground truncate">{topic.title}</h2>
                                                    </div>
                                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                        <span>{topic.author?.username ?? t("deletedAuthor")}</span>
                                                        <span>·</span>
                                                        {/* An absolute date, not "two days ago": the
                                                            server has no reader's clock, and a relative
                                                            one rendered here is wrong by the time it is
                                                            read. */}
                                                        <span>{formatDate(topic.createdAt, undefined, dateTag)}</span>
                                                        {topic.category && (
                                                            <>
                                                                <span>·</span>
                                                                <span
                                                                    className="px-2 py-0.5 rounded text-xs"
                                                                    style={{
                                                                        backgroundColor: (topic.category.color || "#6366f1") + "20",
                                                                        color: topic.category.color || "#6366f1",
                                                                    }}
                                                                >
                                                                    {topic.category.name}
                                                                </span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0">
                                                    <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" aria-hidden="true" />{topic._count.posts}</span>
                                                    <span className="flex items-center gap-1"><Eye className="w-3 h-3" aria-hidden="true" />{topic.views}</span>
                                                    <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" aria-hidden="true" />{topic._count.likes}</span>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            ))}

                            <Pagination page={board.page} pages={board.pages} pageParam="page" />
                        </>
                    )}
                </div>
            </div>
        </PageFrame>
    );
}
