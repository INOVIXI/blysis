"use client";

import { useState, useEffect, use, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Link } from "@/core/sdk/navigation";
import { Button, Card, CardContent, LoadFailed, RichContent, Textarea, useConfirm, useLocalDate } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { writeError } from "@/core/sdk";
import { toast } from "sonner";
import { Loader2, MessageSquare, ThumbsUp, Trash2 } from "lucide-react";
import { STATUS_BADGE_CLASS, canonicalStatus } from "../../../lib/statuses";

/**
 * A row written before the board's vocabulary settled may hold a status this
 * version has no word for. It is printed as it stands rather than folded into
 * the first word in the list, which is how a declined idea came to be
 * labelled "Open" to everyone reading it.
 */
function statusLabel(t: { (key: string): string }, status: string): string {
    const known = canonicalStatus(status);
    return known ? t(known) : status;
}

function badgeClass(status: string): string {
    const known = canonicalStatus(status);
    return known ? STATUS_BADGE_CLASS[known] : "bg-muted text-muted-foreground";
}

/**
 * One suggestion, and what people said about it.
 *
 * The board could only ever answer "how many want this". An operator deciding
 * what to build next needs the other half - what people want out of it, what
 * they would settle for, who has already tried the workaround - and that only
 * exists if there is somewhere to say it.
 */

interface Author {
    id: string;
    username: string;
    avatar: string | null;
}

interface Suggestion {
    id: string;
    title: string;
    content: string;
    status: string;
    upvotes: number;
    createdAt: string;
    author: Author | null;
}

interface Comment {
    id: string;
    content: string;
    createdAt: string;
    moderationState: string;
    author: Author | null;
}

export default function SuggestionPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const t = useTranslations("suggestions");
    const commonT = useTranslations("common");
    const { data: session } = useSession();
    const formatLocalDate = useLocalDate();
    const { confirm } = useConfirm();

    const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
    const [comments, setComments] = useState<Comment[]>([]);
    const [truncated, setTruncated] = useState(false);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    const [voted, setVoted] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [one, thread] = await Promise.all([
                fetch(`/api/v1/suggestions/${id}`).then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); }),
                fetch(`/api/v1/suggestions/${id}/comments`).then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); }),
            ]);
            const row = one.suggestion ?? one;
            setSuggestion(row);
            setVoted(Boolean(row?.voted));
            setComments(thread?.data?.comments ?? []);
            setTruncated(Boolean(thread?.data?.truncated));
            setFailed(false);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { void load(); }, [load, reloadKey]);

    const send = async () => {
        if (!draft.trim()) return;
        setSending(true);
        try {
            const res = await fetch(`/api/v1/suggestions/${id}/comments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: draft.trim() }),
            });
            if (!res.ok) {
                toast.error(await writeError(res, commonT("somethingWentWrong"), commonT));
                return;
            }
            setDraft("");
            setReloadKey((k) => k + 1);
        } finally {
            setSending(false);
        }
    };

    const remove = async (commentId: string) => {
        // Deleting is the one thing here that cannot be undone.
        const sure = await confirm({
            title: t("deleteCommentTitle"),
            message: t("deleteCommentBody"),
            confirmText: commonT("delete"),
            variant: "danger",
        });
        if (!sure) return;
        const res = await fetch(`/api/v1/suggestions/comments/${commentId}`, { method: "DELETE" });
        if (!res.ok) {
            toast.error(await writeError(res, commonT("somethingWentWrong"), commonT));
            return;
        }
        setComments((prev) => prev.filter((c) => c.id !== commentId));
    };

    const vote = async () => {
        const res = await fetch(`/api/v1/suggestions/${id}/vote`, { method: "POST" });
        if (!res.ok) return;
        const data = await res.json();
        setVoted(Boolean(data.voted));
        setSuggestion((prev) => (prev ? { ...prev, upvotes: data.upvotes ?? prev.upvotes } : prev));
    };

    return (
        <PageFrame
            title={suggestion?.title ?? t("title")}
            trail={[{ label: t("title"), href: "/suggestions" }]}
            sidebar={suggestion ? (
                <div className="bg-card rounded-xl border border-border p-5 space-y-4">
                    <div>
                        <p className="text-sm text-muted-foreground">{t("status")}</p>
                        <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded ${badgeClass(suggestion.status)}`}>
                            {statusLabel(t, suggestion.status)}
                        </span>
                    </div>
                    <div>
                        <p className="text-sm text-muted-foreground">{t("votes")}</p>
                        <p className="text-2xl font-bold text-foreground">{suggestion.upvotes}</p>
                    </div>
                    {session?.user && (
                        <Button
                            variant={voted ? "default" : "outline"}
                            aria-pressed={voted}
                            className="w-full"
                            onClick={vote}
                        >
                            <ThumbsUp className="w-4 h-4" /> {voted ? t("removeVote") : t("upvote")}
                        </Button>
                    )}
                    <p className="text-xs text-muted-foreground">
                        {t("submittedBy")} {suggestion.author?.username ?? t("deletedUser")} · {formatLocalDate(suggestion.createdAt)}
                    </p>
                </div>
            ) : null}
        >
            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : failed ? (
                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
            ) : !suggestion ? (
                <Card><CardContent className="py-12 text-center space-y-3">
                    <p className="text-muted-foreground">{t("notFound")}</p>
                    <Link href="/suggestions" className="text-sm text-primary hover:underline">{t("backToBoard")}</Link>
                </CardContent></Card>
            ) : (
                <div className="space-y-6">
                    <Card>
                        <CardContent className="p-6">
                            <RichContent markdown={suggestion.content} keepLineBreaks />
                        </CardContent>
                    </Card>

                    <section aria-labelledby="discussion">
                        <h2 id="discussion" className="text-xl font-bold text-foreground mb-4">
                            {t("discussion", { count: comments.length })}
                        </h2>

                        {comments.length === 0 ? (
                            <Card><CardContent className="py-10 text-center text-muted-foreground">
                                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-60" aria-hidden="true" />
                                {t("noComments")}
                            </CardContent></Card>
                        ) : (
                            <ul className="space-y-3">
                                {comments.map((comment) => (
                                    <li key={comment.id}>
                                        <Card>
                                            <CardContent className="p-4">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-foreground">
                                                            {comment.author?.username ?? t("deletedUser")}
                                                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                                                {formatLocalDate(comment.createdAt)}
                                                            </span>
                                                            {comment.moderationState === "PENDING" && (
                                                                <span className="ml-2 text-xs font-normal text-warning">{t("awaitingReview")}</span>
                                                            )}
                                                        </p>
                                                        <RichContent className="mt-2 text-sm" markdown={comment.content} keepLineBreaks />
                                                    </div>
                                                    {comment.author?.id === session?.user?.id && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            aria-label={commonT("delete")}
                                                            onClick={() => remove(comment.id)}
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {truncated && (
                            <p className="mt-3 text-sm text-muted-foreground">{t("discussionTruncated")}</p>
                        )}

                        <Card className="mt-4">
                            <CardContent className="p-4">
                                {session?.user ? (
                                    <div className="space-y-3">
                                        <Textarea
                                            value={draft}
                                            onChange={(e) => setDraft(e.target.value)}
                                            rows={4}
                                            maxLength={4000}
                                            placeholder={t("commentPlaceholder")}
                                            aria-label={t("commentPlaceholder")}
                                        />
                                        <div className="flex justify-end">
                                            <Button onClick={send} disabled={sending || draft.trim().length < 2}>
                                                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                                {t("postComment")}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-center text-muted-foreground py-4">{t("loginToComment")}</p>
                                )}
                            </CardContent>
                        </Card>
                    </section>
                </div>
            )}
        </PageFrame>
    );
}
