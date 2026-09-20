"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Button, LoadFailed, MemberAvatar, MemberLink, Textarea, useRelativeTime } from "@/core/sdk/ui";
import { Loader2, MessageCircle, Send } from "lucide-react";

interface Comment {
    id: string;
    content: string;
    createdAt: string;
    moderationState?: string;
    author: { id: string; username: string; avatar?: string | null };
}

/**
 * The conversation under an article.
 *
 * It was a stack of bordered boxes with a name, a dot and a date in one grey
 * line, and no face anywhere - on a community site, where a comment is read as
 * much for who wrote it as for what it says, and where every other list had
 * already moved to the shared avatar. The name was not a link either, so the
 * one screen where members meet each other was the one screen with no way from
 * a member to their profile.
 *
 * And the box to write in was an `<input>`: one line, no wrapping, no way to
 * see the second sentence of what you had typed.
 *
 * Now: a face beside every comment and beside the box you write in, the name
 * goes to the person, the body wraps, and the rows are separated by a hairline
 * rather than each being its own card - a card per comment made ten comments
 * look like ten unrelated notices.
 *
 * The endpoint is `/blog/comments?articleId=`, not `/blog/<id>/comments`.
 * This component asked for the second one, which the manifest never declared:
 * the dispatcher answered 404, the `.then` swallowed it, and the section
 * rendered an empty comment list on every article while posting silently did
 * nothing. `validate-module` now fails a module whose components fetch a path
 * it does not route.
 */
export function CommentSection({ postId, articleId }: { postId?: string; articleId?: string }) {
    const id = postId || articleId || "";
    const t = useTranslations("blog");
    const commonT = useTranslations("common");
    const relativeTime = useRelativeTime();
    const { data: session } = useSession();
    const [comments, setComments] = useState<Comment[]>([]);
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [pending, setPending] = useState(false);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (!id) { setLoading(false); return; }
        fetch(`/api/v1/blog/comments?articleId=${encodeURIComponent(id)}`)
            .then(r => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then(data => {
                if (cancelled) return;
                setComments(Array.isArray(data) ? data : []);
                setFailed(false);
            })
            .catch(() => { if (!cancelled) setFailed(true); })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [id, reloadKey]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!content.trim() || !id) return;
        setSubmitting(true);
        try {
            const res = await fetch("/api/v1/blog/comments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content, articleId: id }),
            });
            if (res.ok) {
                const comment: Comment = await res.json();
                // A site that moderates manually files the comment as PENDING.
                // Showing it in the list would tell the author it is live when
                // a reload will not show it.
                if (comment.moderationState === "PENDING") setPending(true);
                else setComments(prev => [comment, ...prev]);
                setContent("");
            }
        } catch {
            // Silent before: the button re-enabled, the box kept the text, and
            // nothing said the comment had not gone anywhere.
            toast.error(commonT("somethingWentWrong"));
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="space-y-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
                <MessageCircle className="w-5 h-5" aria-hidden="true" />
                {t("comments")} ({comments.length})
            </h2>
            <form onSubmit={handleSubmit} className="flex gap-3">
                <MemberAvatar
                    name={session?.user?.name ?? "?"}
                    src={session?.user?.image ?? null}
                    size={36}
                    className="mt-1"
                />
                <div className="flex-1 space-y-2">
                    <Textarea
                        value={content}
                        onChange={e => setContent(e.target.value)}
                        placeholder={t("writeComment")}
                        aria-label={t("writeComment")}
                        rows={3}
                    />
                    <div className="flex justify-end">
                        <Button type="submit" size="sm" disabled={submitting || !content.trim()}>
                            {submitting
                                ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                : <Send className="w-4 h-4" aria-hidden="true" />}
                            {t("postComment")}
                        </Button>
                    </div>
                </div>
            </form>
            {pending && (
                <p className="text-sm text-muted-foreground" role="status">{t("commentPending")}</p>
            )}
            <div className="divide-y divide-border">
                {comments.map(comment => (
                    <article key={comment.id} className="flex gap-3 py-4 first:pt-0">
                        <MemberAvatar
                            name={comment.author?.username ?? "?"}
                            src={comment.author?.avatar}
                            size={36}
                            className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                                <MemberLink
                                    username={comment.author?.username ?? "?"}
                                    hideAvatar
                                    nameClassName="text-sm"
                                />
                                <span className="text-xs text-muted-foreground">
                                    {relativeTime(comment.createdAt)}
                                </span>
                            </div>
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                                {comment.content}
                            </p>
                        </div>
                    </article>
                ))}
                {failed ? (
                    <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
                ) : comments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("noComments")}</p>
                ) : null}
            </div>
        </div>
    );
}
