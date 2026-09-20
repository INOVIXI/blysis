"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Loader2, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CheckboxField,
    MemberAvatar,
    MemberLink,
    Pagination,
    Textarea,
    useConfirm,
    useRelativeTime,
} from "@/core/sdk/ui";
import { errorMessage } from "@/core/sdk";

interface Author {
    id: string;
    username: string;
    avatar: string | null;
}

interface Reply {
    id: string;
    body: string;
    createdAt: string;
    authorId: string;
    author: Author;
}

interface Post {
    id: string;
    body: string;
    createdAt: string;
    authorId: string;
    author: Author;
    replies: Reply[];
    _count: { replies: number };
}

interface Page {
    page: number;
    pages: number;
    total: number;
}

/**
 * A wall of notes on somebody's profile.
 *
 * The public profile was a header, five counters and, on most accounts,
 * nothing else - a page about a person with no way to say anything to them or
 * about them. This is that: short notes addressed to the member, with one
 * level of replies under each.
 *
 * It arrives through a slot rather than being part of the profile module, so a
 * site that does not want a wall turns this off and the page closes over the
 * gap. The context the slot hands over is the member being looked at.
 *
 * The first few replies of each note are drawn with it, because a note with
 * two replies under it is the common case and hiding them behind a control
 * turns reading a wall into clicking through one.
 */
export default function ProfileWall({ userId, username }: { userId?: string; username?: string }) {
    const t = useTranslations("profilePosts");
    const { data: session } = useSession();
    const relativeTime = useRelativeTime();
    const { confirm } = useConfirm();

    const [posts, setPosts] = useState<Post[]>([]);
    const [paging, setPaging] = useState<Page>({ page: 1, pages: 1, total: 0 });
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState(true);
    const [loading, setLoading] = useState(true);
    const [body, setBody] = useState("");
    const [posting, setPosting] = useState(false);
    const [replyTo, setReplyTo] = useState<string | null>(null);
    const [replyBody, setReplyBody] = useState("");
    const [switching, setSwitching] = useState(false);

    const me = session?.user?.id ?? null;
    const mine = me !== null && me === userId;

    const load = useCallback(async () => {
        if (!userId) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/v1/profile-posts?profileUserId=${encodeURIComponent(userId)}&page=${page}`);
            const data = await res.json();
            setPosts(data.posts ?? []);
            setOpen(data.open !== false);
            setPaging(data.pagination ?? { page: 1, pages: 1, total: 0 });
        } finally {
            setLoading(false);
        }
    }, [userId, page]);

    useEffect(() => { load(); }, [load]);

    if (!userId) return null;

    const write = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!body.trim()) return;
        setPosting(true);
        try {
            const res = await fetch("/api/v1/profile-posts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ profileUserId: userId, body: body.trim() }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                toast.error(errorMessage(data, t("post"), t));
                return;
            }
            setBody("");
            // Back to the first page: what was just written is at the top of
            // it, and a reader on page three would otherwise see nothing
            // happen.
            if (page !== 1) setPage(1);
            else load();
        } finally {
            setPosting(false);
        }
    };

    const reply = async (postId: string) => {
        if (!replyBody.trim()) return;
        const res = await fetch(`/api/v1/profile-posts/${postId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: replyBody.trim() }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            toast.error(errorMessage(data, t("reply"), t));
            return;
        }
        setReplyBody("");
        setReplyTo(null);
        load();
    };

    /** The owner's own switch. Nobody else's wall is theirs to shut. */
    const setOpen_ = async (next: boolean) => {
        setSwitching(true);
        try {
            const res = await fetch("/api/v1/profile-posts", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ open: next }),
            });
            if (!res.ok) {
                toast.error(t("title"));
                return;
            }
            setOpen(next);
            if (next) load();
        } finally {
            setSwitching(false);
        }
    };

    const remove = async (postId: string) => {
        const ok = await confirm({
            title: t("deleteConfirmTitle"),
            message: t("deleteConfirmMessage"),
            variant: "danger",
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/profile-posts/${postId}`, { method: "DELETE" });
        if (!res.ok) {
            const data = await res.json().catch(() => null);
            toast.error(errorMessage(data, t("delete"), t));
            return;
        }
        setPosts((prev) => prev.filter((p) => p.id !== postId));
    };

    return (
        <Card className="mt-6">
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle>{t("title")}</CardTitle>
                {mine && (
                    <CheckboxField
                        checked={open}
                        disabled={switching}
                        onChange={(e) => setOpen_(e.target.checked)}
                        label={<span className="text-sm font-normal">{t("setting_open")}</span>}
                    />
                )}
            </CardHeader>
            <CardContent className="space-y-5">
                {!open ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        {mine ? t("setting_openDesc") : t("closed")}
                    </p>
                ) : (
                    <>
                        {me ? (
                            <form onSubmit={write} className="flex gap-3">
                                <MemberAvatar
                                    name={session?.user?.name ?? "?"}
                                    src={session?.user?.image ?? null}
                                    size={36}
                                    className="mt-1"
                                />
                                <div className="flex-1 space-y-2">
                                    <Textarea
                                        value={body}
                                        onChange={(e) => setBody(e.target.value)}
                                        placeholder={mine ? t("writeOwn") : t("write")}
                                        aria-label={mine ? t("writeOwn") : t("write")}
                                        rows={2}
                                    />
                                    <div className="flex justify-end">
                                        <Button type="submit" size="sm" disabled={posting || !body.trim()}>
                                            {posting
                                                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                                : <Send className="h-4 w-4" aria-hidden="true" />}
                                            {t("post")}
                                        </Button>
                                    </div>
                                </div>
                            </form>
                        ) : (
                            <p className="text-sm text-muted-foreground">{t("signIn")}</p>
                        )}

                        {loading ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : posts.length === 0 ? (
                            <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
                        ) : (
                            <ul className="divide-y divide-border">
                                {posts.map((post) => (
                                    <li key={post.id} className="py-4 first:pt-0">
                                        <div className="flex gap-3">
                                            <MemberAvatar name={post.author.username} src={post.author.avatar} size={36} className="mt-0.5" />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-baseline gap-x-2">
                                                    <MemberLink username={post.author.username} hideAvatar nameClassName="text-sm" />
                                                    <span className="text-xs text-muted-foreground">{relativeTime(post.createdAt)}</span>
                                                    {me && (post.authorId === me || mine) && (
                                                        <button
                                                            type="button"
                                                            onClick={() => remove(post.id)}
                                                            aria-label={t("delete")}
                                                            className="ml-auto text-muted-foreground transition-colors hover:text-destructive"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                                        </button>
                                                    )}
                                                </div>
                                                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{post.body}</p>

                                                {post.replies.length > 0 && (
                                                    <ul className="mt-3 space-y-3 border-l border-border pl-3">
                                                        {post.replies.map((r) => (
                                                            <li key={r.id} className="flex gap-2">
                                                                <MemberAvatar name={r.author.username} src={r.author.avatar} size={24} className="mt-0.5" />
                                                                <div className="min-w-0">
                                                                    <div className="flex flex-wrap items-baseline gap-x-2">
                                                                        <MemberLink username={r.author.username} hideAvatar nameClassName="text-xs" />
                                                                        <span className="text-[11px] text-muted-foreground">{relativeTime(r.createdAt)}</span>
                                                                    </div>
                                                                    <p className="whitespace-pre-wrap text-sm text-foreground">{r.body}</p>
                                                                </div>
                                                            </li>
                                                        ))}
                                                        {post._count.replies > post.replies.length && (
                                                            <li className="text-xs text-muted-foreground">
                                                                {t("showReplies", { count: post._count.replies })}
                                                            </li>
                                                        )}
                                                    </ul>
                                                )}

                                                {me && (
                                                    replyTo === post.id ? (
                                                        <div className="mt-3 flex gap-2">
                                                            <Textarea
                                                                value={replyBody}
                                                                onChange={(e) => setReplyBody(e.target.value)}
                                                                placeholder={t("replyPlaceholder")}
                                                                aria-label={t("replyPlaceholder")}
                                                                rows={2}
                                                                className="flex-1"
                                                            />
                                                            <Button
                                                                size="sm"
                                                                aria-label={t("reply")}
                                                                onClick={() => reply(post.id)}
                                                                disabled={!replyBody.trim()}
                                                            >
                                                                <Send className="h-4 w-4" aria-hidden="true" />
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => { setReplyTo(post.id); setReplyBody(""); }}
                                                            className="mt-2 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
                                                        >
                                                            {t("reply")}
                                                        </button>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {!loading && posts.length > 0 && (
                            <Pagination page={paging.page} pages={paging.pages} total={paging.total} onPageChange={setPage} />
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
