"use client";

import { useState, useEffect, useRef } from "react";
import { MemberAvatar } from "@/core/sdk/ui";
import { useRouter } from "@/core/sdk/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Link } from "@/core/sdk/navigation";
import { Badge, Button, Card, CardContent, Pagination, RichContent, Textarea } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { Pin, Lock, Eye, ThumbsUp, Send, Loader2, Pencil, Quote, Trash2, X } from "lucide-react";
import { useRelativeTime } from "@/core/sdk/ui";
import { useTranslations } from "next-intl";
import { errorMessage } from "@/core/sdk";
import { useConfirm } from "@/core/sdk/ui";

/**
 * What a reply may hold, in characters.
 *
 * `forumPostSchema` caps it at fifty thousand and the box held no bound at
 * all, so the only way to learn was to type past it, press the button and be
 * told nothing.
 */
const REPLY_LIMIT = 50_000;

interface Post {
    id: string;
    content: string;
    createdAt: string;
    /** Null once the account has been erased; the post stays. */
    author: { id: string; username: string; avatar: string | null } | null;
    _count: { likes: number };
    /** Whether the person reading this reply has already liked it. */
    liked: boolean;
}

interface Topic {
    id: string;
    title: string;
    slug: string;
    content: string;
    isPinned: boolean;
    isLocked: boolean;
    views: number;
    createdAt: string;
    author: { id: string; username: string; avatar: string | null } | null;
    category: { id: string; name: string; slug: string; color: string | null };
    posts: Post[];
    _count: { likes: number };
}

/**
 * The topic, drawn from what the server already read.
 *
 * It used to fetch the topic itself on mount, which is why none of a topic -
 * not the title, not the opening post, not one reply - was ever in the HTML
 * the server sent, for all 58 topics the sitemap publishes. The server renders
 * it now and hands it over; this still owns replying, liking and paging
 * through the replies, and asks the endpoint again for those.
 */
export function TopicView({
    initialTopic,
    initialPostsPages,
    canModerate = false,
}: {
    initialTopic: Topic;
    initialPostsPages: number;
    /**
     * Whether this reader may work on anybody's post. Asked on the server,
     * where the permission lives; the author's own rights are decided here,
     * because the author is the author.
     */
    canModerate?: boolean;
}) {
    const t = useTranslations('forum');
    const commonT = useTranslations('common');
    const router = useRouter();
    const { confirm } = useConfirm();
    const { data: session } = useSession();
    const replyBox = useRef<HTMLTextAreaElement>(null);
    const relativeTime = useRelativeTime();
    const topicId = initialTopic.id;

    const [topic, setTopic] = useState<Topic | null>(initialTopic);
    const [loading, setLoading] = useState(false);
    const [replyContent, setReplyContent] = useState("");
    const [editingTopic, setEditingTopic] = useState(false);
    const [topicDraft, setTopicDraft] = useState(initialTopic.content);
    const [savingTopic, setSavingTopic] = useState(false);
    const [sending, setSending] = useState(false);
    const [liked, setLiked] = useState(false);
    const [likeCount, setLikeCount] = useState(0);
    const [postsPage, setPostsPage] = useState(1);
    const [postsPages, setPostsPages] = useState(initialPostsPages);
    const [restricted, setRestricted] = useState(false);

    // `isStale` lets the effect below drop a response for a page the reader has
    // already left. Action handlers call fetchTopic with no predicate: their
    // response is always the one wanted.
    const fetchTopic = (page = postsPage, isStale: () => boolean = () => false) => {
        fetch(`/api/v1/forum/topics/${topicId}?postsPage=${page}`)
            .then(async (r) => {
                if (isStale()) return null;
                if (r.status === 403) { setRestricted(true); return null; }
                return r.json();
            })
            .then((d) => {
                if (isStale()) return;
                if (d) {
                    setTopic(d.topic || null);
                    setPostsPages(d.postsPages || 1);
                }
                setLoading(false);
            })
            .catch(() => {
                if (isStale()) return;
                setLoading(false);
            });
    };

    // The first page is the one the server rendered, so asking for it again
    // would be a second read of the same rows and a second counted view. A ref
    // rather than state: this decides what an effect does, and it must not be
    // the reason the effect runs.
    const serverDrewThisPage = useRef(true);

    useEffect(() => {
        let cancelled = false;
        if (serverDrewThisPage.current) serverDrewThisPage.current = false;
        else fetchTopic(postsPage, () => cancelled);
        // Check like status
        fetch(`/api/v1/forum/topics/${topicId}/like`)
            .then((r) => r.json())
            .then((d) => {
                if (cancelled) return;
                setLiked(d.liked);
                setLikeCount(d.count);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [topicId, postsPage]);  // eslint-disable-line react-hooks/exhaustive-deps

    const toggleLike = async () => {
        if (!topic) return;
        if (!session?.user) {
            toast.error(t("loginToLike"));
            router.push("/auth/login");
            return;
        }
        try {
            const res = await fetch(`/api/v1/forum/topics/${topic.id}/like`, { method: "POST" });
            if (res.ok) {
                const data = await res.json();
                setLiked(data.liked);
                setLikeCount(data.count);
            } else if (res.status === 401) {
                toast.error(t("loginToLike"));
                router.push("/auth/login");
            } else {
                toast.error(t("likeError"));
            }
        } catch (err) {
            console.error("Failed to toggle like:", err);
            toast.error(t("likeError"));
        }
    };

    /**
     * Quote a reply into the box below.
     *
     * Markdown is what a person writes here, so a quote is what Markdown
     * already has: the lines prefixed with `>` under the name of whoever
     * wrote them. Without it every long thread turns into "as the person
     * above said".
     */
    const quotePost = (author: string, content: string) => {
        const quoted = content.split("\n").map((line) => `> ${line}`).join("\n");
        setReplyContent((held) => `${held ? `${held}\n\n` : ""}**${author}**\n${quoted}\n\n`);
        replyBox.current?.focus();
    };

    /**
     * The opening post, changed by whoever wrote it or whoever the site
     * trusts with anybody's. `PATCH /forum/topics/[id]` has taken a title and
     * a body since it was written and no screen had ever sent either, so a
     * member who mistyped their own question lived with it.
     */
    const saveTopic = async () => {
        if (!topic) return;
        setSavingTopic(true);
        try {
            const res = await fetch(`/api/v1/forum/topics/${topic.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: topicDraft }),
            });
            if (!res.ok) {
                const said = await res.json().catch(() => null);
                toast.error(errorMessage(said, t("editFailed"), t));
                return;
            }
            setEditingTopic(false);
            fetchTopic();
            router.refresh();
        } finally {
            setSavingTopic(false);
        }
    };

    const submitReply = async () => {
        if (!replyContent.trim() || !topic) return;
        setSending(true);
        try {
            const res = await fetch(`/api/v1/forum/topics/${topic.id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: replyContent }),
            });
            if (res.ok) {
                setReplyContent("");
                fetchTopic();
            } else {
                /*
                 * It used to be `if (res.ok)` and nothing else, so a member
                 * the site has restricted from the forum, one posting where
                 * they may not reply and one whose reply is too long all
                 * pressed the button and watched nothing happen. The endpoint
                 * sends a code; the words are chosen here.
                 */
                const said = await res.json().catch(() => null);
                toast.error(errorMessage(said, t("replyFailed"), t));
            }
        } catch {
            toast.error(t("replyFailed"));
        } finally {
            setSending(false);
        }
    };

    const renderAvatar = (user: { username: string; avatar: string | null }) => (
        <MemberAvatar name={user.username} src={user.avatar} size={40} />
    );

    return (
        <PageFrame
            title={topic?.title ?? t('title')}
            trail={[{ label: t('title'), href: '/forum' }]}
        >
            {loading ? (
                <div className="text-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
                </div>
            ) : restricted ? (
                <Card>
                    <CardContent className="py-12 text-center space-y-3">
                        <p className="text-muted-foreground">{t('guestViewDisabled')}</p>
                        <Link href="/auth/login" className="text-primary hover:underline text-sm">{t('signIn')}</Link>
                    </CardContent>
                </Card>
            ) : !topic ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <p className="text-muted-foreground">{t('topicNotFound')}</p>
                    </CardContent>
                </Card>
            ) : (
                <>
                    {/* The title is the page's, so the frame draws it. What
                        is left here says what state the topic is in, and a
                        bare icon says it to nobody using a screen reader. */}
                    <div className="mb-6">
                        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                            {topic.isPinned && (
                                <span className="flex items-center gap-1 text-primary">
                                    <Pin className="w-3 h-3" aria-hidden="true" />{t('pinned')}
                                </span>
                            )}
                            {topic.isLocked && (
                                <span className="flex items-center gap-1">
                                    <Lock className="w-3 h-3" aria-hidden="true" />{t('locked')}
                                </span>
                            )}
                            <span
                                className="px-2 py-0.5 rounded text-xs"
                                style={{
                                    backgroundColor: (topic.category.color || "#6366f1") + "20",
                                    color: topic.category.color || "#6366f1",
                                }}
                            >
                                {topic.category.name}
                            </span>
                            <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{t('viewsCount', { count: topic.views })}</span>
                            <button
                                onClick={toggleLike}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${liked ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                            >
                                <ThumbsUp className={`w-3 h-3 ${liked ? "fill-primary" : ""}`} />
                                {t('likesCount', { count: likeCount })}
                            </button>
                        </div>
                    </div>

                    {/* The opening post.
                        It used to be marked with a four pixel blue rule down
                        its left edge, in `blue-500` rather than a token, so a
                        theme that is not blue got a blue stripe anyway. It is
                        the first post above a heading that counts the
                        replies, and its body is set at full size against
                        their `text-sm`, which is the hierarchy a forum
                        actually has. A coloured bar was decoration standing
                        in for it. */}
                    <Card className="mb-4">
                        <CardContent className="p-6">
                            <div className="flex items-center gap-3 mb-4">
                                {topic.author && renderAvatar(topic.author)}
                                <div>
                                    <p className="font-medium text-foreground">{topic.author?.username ?? t('deletedAuthor')}</p>
                                    <p className="text-xs text-muted-foreground">{relativeTime(new Date(topic.createdAt))}</p>
                                </div>
                            </div>
                            {/* Typed into a box with no preview: every line
                                the member ended is a line a reader sees. */}
                            {editingTopic ? (
                                <>
                                    <Textarea
                                        value={topicDraft}
                                        onChange={(e) => setTopicDraft(e.target.value)}
                                        aria-label={t("editPost")}
                                        rows={8}
                                        maxLength={REPLY_LIMIT}
                                        className="mb-2"
                                    />
                                    <div className="flex gap-2">
                                        <Button size="sm" onClick={saveTopic} disabled={savingTopic || !topicDraft.trim()}>
                                            {commonT("save")}
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => { setTopicDraft(topic.content); setEditingTopic(false); }}>
                                            <X className="w-3 h-3" aria-hidden="true" /> {commonT("cancel")}
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <RichContent
                                        markdown={topic.content}
                                        keepLineBreaks
                                    />
                                    <div className="mt-3 flex items-center gap-1">
                                        {!topic.isLocked && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                aria-label={t("quote")}
                                                title={t("quote")}
                                                onClick={() => quotePost(topic.author?.username ?? t("deletedAuthor"), topic.content)}
                                            >
                                                <Quote className="w-3 h-3" aria-hidden="true" />
                                            </Button>
                                        )}
                                        {(canModerate || topic.author?.id === session?.user?.id) && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                aria-label={commonT("edit")}
                                                title={commonT("edit")}
                                                onClick={() => setEditingTopic(true)}
                                            >
                                                <Pencil className="w-3 h-3" aria-hidden="true" />
                                            </Button>
                                        )}
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {/* Replies */}
                    {topic.posts.length > 0 && (
                        <div className="space-y-3 mb-6">
                            <h2 className="text-sm font-medium text-muted-foreground">{t('repliesCount', { count: topic.posts.length })}</h2>
                            {topic.posts.map((post) => (
                                <PostCard
                                    key={post.id}
                                    post={post}
                                    renderAvatar={renderAvatar}
                                    topicAuthor={topic.author?.username ?? null}
                                    mayWork={canModerate || post.author?.id === session?.user?.id}
                                    mayQuote={!topic.isLocked}
                                    onQuote={quotePost}
                                    onChanged={fetchTopic}
                                />
                            ))}
                        </div>
                    )}

                    {/* Reply pager - a long thread arrives a page at a time */}
                    <Pagination page={postsPage} pages={postsPages} onPageChange={setPostsPage} className="mb-6" />

                    {/* Reply Form */}
                    {!topic.isLocked ? (
                        <Card>
                            <CardContent className="p-5">
                                <h2 className="font-medium text-foreground mb-3">{t('reply')}</h2>
                                {/* The same bound the endpoint holds. Without
                                    it a long reply was typed, sent, refused
                                    and silently lost. */}
                                <Textarea
                                    ref={replyBox}
                                    value={replyContent}
                                    onChange={(e) => setReplyContent(e.target.value)}
                                    placeholder={t('writeYourReply')} aria-label={t('writeYourReply')}
                                    rows={4}
                                    maxLength={REPLY_LIMIT}
                                    className="mb-1"
                                />
                                <p className="mb-3 text-xs text-muted-foreground">
                                    {replyContent.length > REPLY_LIMIT * 0.8
                                        ? t("replyRoomLeft", { left: REPLY_LIMIT - replyContent.length })
                                        : ""}
                                </p>
                                <Button onClick={submitReply} disabled={sending || !replyContent.trim()}>
                                    {sending ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> {t('posting')}</>
                                    ) : (
                                        <><Send className="w-4 h-4" /> {t('postReply')}</>
                                    )}
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="text-center py-4 text-muted-foreground text-sm">
                            <Lock className="w-4 h-4 inline mr-1" /> {t('topicLocked')}
                        </div>
                    )}
                </>
            )}
        </PageFrame>
    );
}

function PostCard({ post, renderAvatar, topicAuthor, mayWork, mayQuote, onQuote, onChanged }: {
    post: Post;
    renderAvatar: (user: { username: string; avatar: string | null }) => React.ReactNode;
    /** Who asked, so a reply from them can say so. */
    /** Null once that account has been erased, so nobody matches it. */
    topicAuthor: string | null;
    /** Whether this reader may change or remove this particular reply. */
    mayWork: boolean;
    mayQuote: boolean;
    onQuote: (author: string, content: string) => void;
    onChanged: () => void;
}) {
    const t = useTranslations('forum');
    const commonT = useTranslations('common');
    const { confirm } = useConfirm();
    const relativeTime = useRelativeTime();
    const [postLiked, setPostLiked] = useState(Boolean(post.liked));
    const [postLikeCount, setPostLikeCount] = useState(post._count.likes);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(post.content);
    const [saving, setSaving] = useState(false);

    /*
     * `PATCH` and `DELETE /forum/posts/[id]` were written carefully - the
     * author is the author, editing somebody else's post and removing it are
     * separate grants, both snapshot a revision first - and nothing in the
     * product had ever called either. A member who typed a word wrong lived
     * with it, and a moderator who wanted one reply gone had to delete the
     * topic it was in.
     */
    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch(`/api/v1/forum/posts/${post.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: draft }),
            });
            if (!res.ok) {
                const said = await res.json().catch(() => null);
                toast.error(errorMessage(said, t("editFailed"), t));
                return;
            }
            setEditing(false);
            onChanged();
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        const sure = await confirm({
            title: t("deletePostTitle"),
            message: t("deletePostConfirm"),
            confirmText: commonT("delete"),
            variant: "danger",
        });
        if (!sure) return;
        const res = await fetch(`/api/v1/forum/posts/${post.id}`, { method: "DELETE" });
        if (!res.ok) {
            const said = await res.json().catch(() => null);
            toast.error(errorMessage(said, t("deleteFailed"), t));
            return;
        }
        onChanged();
    };

    const togglePostLike = async () => {
        try {
            const res = await fetch(`/api/v1/forum/posts/${post.id}/like`, { method: "POST" });
            if (res.ok) {
                const data = await res.json();
                setPostLiked(data.liked);
                setPostLikeCount(data.count);
            }
        } catch (err) {
            console.error("Failed to toggle post like:", err);
        }
    };

    return (
        <Card>
            <CardContent className="p-5" data-post={post.id}>
                <div className="flex items-center gap-3 mb-3">
                    {post.author && renderAvatar(post.author)}
                    <div>
                        <div className="flex items-center gap-2">
                            <p className="font-medium text-foreground text-sm">{post.author?.username ?? t('deletedAuthor')}</p>
                            {/* Which of these replies is the person who asked.
                                That is the thing a reader scanning a thread
                                looks for, and it is worth more than a stripe
                                marking the post they are already reading. */}
                            {post.author && post.author.username === topicAuthor && (
                                <Badge tone="neutral">{t('topicAuthor')}</Badge>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">{relativeTime(new Date(post.createdAt))}</p>
                    </div>
                </div>
                {editing ? (
                    <div className="mb-3">
                        <Textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            aria-label={t("editPost")}
                            rows={4}
                            maxLength={REPLY_LIMIT}
                            className="mb-2"
                        />
                        <div className="flex gap-2">
                            <Button size="sm" onClick={save} disabled={saving || !draft.trim()}>
                                {commonT("save")}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setDraft(post.content); setEditing(false); }}>
                                <X className="w-3 h-3" aria-hidden="true" /> {commonT("cancel")}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <RichContent
                        className="text-sm mb-3"
                        markdown={post.content}
                        keepLineBreaks
                    />
                )}
                <div className="flex items-center gap-1">
                    <button
                        onClick={togglePostLike}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${postLiked ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-muted-foreground"}`}
                    >
                        <ThumbsUp className={`w-3 h-3 ${postLiked ? "fill-primary" : ""}`} />
                        {postLikeCount}
                    </button>
                    {mayQuote && (
                        <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t("quote")}
                            title={t("quote")}
                            onClick={() => onQuote(post.author?.username ?? t("deletedAuthor"), post.content)}
                        >
                            <Quote className="w-3 h-3" aria-hidden="true" />
                        </Button>
                    )}
                    {mayWork && !editing && (
                        <>
                            <Button
                                size="sm"
                                variant="ghost"
                                aria-label={commonT("edit")}
                                title={commonT("edit")}
                                onClick={() => setEditing(true)}
                            >
                                <Pencil className="w-3 h-3" aria-hidden="true" />
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                aria-label={commonT("delete")}
                                title={commonT("delete")}
                                onClick={remove}
                                className="text-destructive hover:text-destructive"
                            >
                                <Trash2 className="w-3 h-3" aria-hidden="true" />
                            </Button>
                        </>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
