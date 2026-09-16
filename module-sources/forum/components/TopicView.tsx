"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useRouter } from "@/core/sdk/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Link } from "@/core/sdk/navigation";
import { Badge, Button, Card, CardContent, Pagination, RichContent, Textarea } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { Pin, Lock, Eye, ThumbsUp, Send, Loader2 } from "lucide-react";
import { useRelativeTime } from "@/core/sdk/ui";
import { useTranslations } from "next-intl";

interface Post {
    id: string;
    content: string;
    createdAt: string;
    /** Null once the account has been erased; the post stays. */
    author: { id: string; username: string; avatar: string | null } | null;
    _count: { likes: number };
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
export function TopicView({ initialTopic, initialPostsPages }: { initialTopic: Topic; initialPostsPages: number }) {
    const t = useTranslations('forum');
    const router = useRouter();
    const { data: session } = useSession();
    const relativeTime = useRelativeTime();
    const topicId = initialTopic.id;

    const [topic, setTopic] = useState<Topic | null>(initialTopic);
    const [loading, setLoading] = useState(false);
    const [replyContent, setReplyContent] = useState("");
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
            }
        } catch (err) {
            console.error("Failed to post reply:", err);
        } finally {
            setSending(false);
        }
    };

    const renderAvatar = (user: { username: string; avatar: string | null }) => (
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground font-bold text-sm flex-shrink-0">
            {user.avatar ? (
                <Image src={user.avatar} alt="" width={40} height={40} className="w-full h-full rounded-full object-cover" />
            ) : (
                user.username[0].toUpperCase()
            )}
        </div>
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
                            <RichContent
                                markdown={topic.content}
                                keepLineBreaks
                            />
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
                                <Textarea
                                    value={replyContent}
                                    onChange={(e) => setReplyContent(e.target.value)}
                                    placeholder={t('writeYourReply')} aria-label={t('writeYourReply')}
                                    rows={4}
                                    className="mb-3"
                                />
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

function PostCard({ post, renderAvatar, topicAuthor }: {
    post: Post;
    renderAvatar: (user: { username: string; avatar: string | null }) => React.ReactNode;
    /** Who asked, so a reply from them can say so. */
    /** Null once that account has been erased, so nobody matches it. */
    topicAuthor: string | null;
}) {
    const t = useTranslations('forum');
    const relativeTime = useRelativeTime();
    const [postLiked, setPostLiked] = useState(false);
    const [postLikeCount, setPostLikeCount] = useState(post._count.likes);

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
            <CardContent className="p-5">
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
                <RichContent
                    className="text-sm mb-3"
                    markdown={post.content}
                    keepLineBreaks
                />
                <button
                    onClick={togglePostLike}
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${postLiked ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-muted-foreground"}`}
                >
                    <ThumbsUp className={`w-3 h-3 ${postLiked ? "fill-primary" : ""}`} />
                    {postLikeCount}
                </button>
            </CardContent>
        </Card>
    );
}
