"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { Link, useRouter } from "@/core/sdk/navigation";
import { Button, Card, CardContent, Input, LoadFailed, NativeSelect, Pagination, Textarea, usePagedRows } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { stripHtmlTags } from "@/core/sdk";
import { useLocalDate } from "@/core/sdk/ui";
import { toast } from "sonner";
import { Loader2, ThumbsUp, Plus, X, MessageSquare } from "lucide-react";
import { SUGGESTION_STATUSES, STATUS_BADGE_CLASS, canonicalStatus } from "../lib/statuses";

// Suggestion bodies are stored as rich-text HTML; the list view shows a
// short preview, so strip tags rather than rendering them clamped.
function plainText(html: string): string {
    return stripHtmlTags(html).replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

interface Suggestion {
    id: string;
    title: string;
    content: string;
    status: string;
    upvotes: number;
    createdAt: string;
    author: { id: string; username: string; avatar: string | null };
    _count: { votes: number };
    /** Whether the person reading this row has already voted for it. */
    voted: boolean;
}


/**
 * A status this board has no word for is printed as it stands. It used to
 * fall back to the first word in the list, so a planned or declined
 * suggestion was labelled "Open" to everyone reading the board.
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
 * The board, drawn from what the server already read.
 *
 * It used to fetch the suggestions on mount, so the HTML the server sent held
 * no suggestion and no link to one. The server reads the first view now and
 * hands it over; voting, the form and the filters are still this component's
 * job, and a filter change asks the endpoint as before.
 */
export function SuggestionBoard({ initial }: { initial: { id: string }[] }) {
    const { data: session } = useSession();
    const router = useRouter();
    const pathname = usePathname();
    const t = useTranslations("suggestions");
    const commonT = useTranslations("common");
    const formatLocalDate = useLocalDate();

    const requireLogin = () => {
        toast.error(t("loginToVote"), {
            action: {
                label: t("login"),
                onClick: () => router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname || "/")}`),
            },
        });
    };
    const [suggestions, setSuggestions] = useState<Suggestion[]>(initial as unknown as Suggestion[]);
    const [failed, setFailed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [visibility, setVisibility] = useState("public");
    const [saving, setSaving] = useState(false);
    const [filter, setFilter] = useState("");
    const [sort, setSort] = useState("newest");
    const paged = usePagedRows(suggestions, 10);

    const fetchSuggestions = () => {
        const params = new URLSearchParams({ sort });
        if (filter) params.set("status", filter);

        fetch(`/api/v1/suggestions?${params}`)
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d) => { setSuggestions(d.suggestions || []); setFailed(false); setLoading(false); })
            .catch(() => { setFailed(true); setLoading(false); });
    };

    /*
     * The first view is the one the server rendered, so asking for it again
     * would be a second read of the same rows. A ref rather than state: this
     * decides what an effect does and must not be the reason it runs.
     */
    const serverDrewThisView = useRef(true);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (serverDrewThisView.current) serverDrewThisView.current = false;
        else fetchSuggestions();
    }, [filter, sort]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const res = await fetch("/api/v1/suggestions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, content, visibility }),
            });
            if (res.ok) {
                setTitle(""); setContent(""); setVisibility("public"); setShowForm(false);
                fetchSuggestions();
            } else if (res.status === 401) {
                requireLogin();
            } else {
                toast.error(t("submitFailed"));
            }
        } finally {
            setSaving(false);
        }
    };

    const toggleVote = async (id: string) => {
        if (!session?.user) { requireLogin(); return; }
        const res = await fetch(`/api/v1/suggestions/${id}/vote`, { method: "POST" });
        if (res.ok) {
            const data = await res.json();
            // The row carries the answer, so there is one place that knows
            // it. A set beside the rows was a second one, and it started
            // empty on every load: the button only ever turned on in
            // response to being pressed, so coming back offered to cast a
            // vote that was already cast - and pressing it took it away.
            setSuggestions((prev) =>
                prev.map((s) => s.id === id ? { ...s, upvotes: data.upvotes, voted: Boolean(data.voted) } : s)
            );
        } else if (res.status === 401) {
            requireLogin();
        }
    };

    return (
        <PageFrame
            title={t("title")}
            description={t("description")}
            actions={session?.user ? (
                <Button onClick={() => setShowForm(!showForm)}>
                    {showForm ? <><X className="w-4 h-4" /> {commonT("cancel")}</> : <><Plus className="w-4 h-4" /> {t("newSuggestion")}</>}
                </Button>
            ) : null}
        >
            {showForm && (
                <Card className="mb-6">
                    <CardContent className="p-5">
                        <form onSubmit={handleSubmit} className="space-y-3">
                            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("suggestionTitlePlaceholder")} aria-label={t("suggestionTitlePlaceholder")} required minLength={3} maxLength={200} />
                            <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder={t("suggestionDescriptionPlaceholder")} aria-label={t("suggestionDescriptionPlaceholder")} rows={4} required minLength={10} maxLength={5000} />
                            <div className="flex items-center justify-between gap-3 pt-1">
                                <NativeSelect
                                    value={visibility}
                                    onChange={(e) => setVisibility(e.target.value)}
                                    aria-label={t("visibility")}
                                >
                                    <option value="public">{t("open")}</option>
                                    <option value="private">{t("other")}</option>
                                </NativeSelect>
                                <Button type="submit" disabled={saving}>
                                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                    {t("submitSuggestion")}
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            )}

            {/* Filters */}
            {/* One row, one height. The sort control used to be pushed to
                the far edge by ml-auto, which on a wrapped row left it alone
                on a line of its own. */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                {["", ...SUGGESTION_STATUSES].map((s) => (
                    <Button key={s} variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>
                        {s === "" ? t("status") : t(s)}
                    </Button>
                ))}
                <Button variant="outline" onClick={() => setSort(sort === "newest" ? "popular" : "newest")}>
                    {t("sortBy")}: {sort === "newest" ? t("newest") : t("mostVoted")}
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : failed ? (
                <LoadFailed onRetry={fetchSuggestions} />
            ) : suggestions.length === 0 ? (
                <Card><CardContent className="py-12 text-center">
                    <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                    <p className="text-muted-foreground">{t("noSuggestions")}</p>
                </CardContent></Card>
            ) : (
                <div className="space-y-3">
                    {paged.rows.map((s) => (
                        <Card key={s.id}>
                            <CardContent className="p-4">
                                <div className="flex gap-4">
                                    <button
                                        onClick={() => toggleVote(s.id)}
                                        aria-label={!session?.user ? t("loginToVote") : s.voted ? t("removeVote") : t("upvote")}
                                        aria-pressed={session?.user ? s.voted : undefined}
                                        className={`flex flex-col items-center justify-center px-3 py-2 rounded-lg transition-colors min-w-[60px] cursor-pointer ${
                                            s.voted ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground hover:bg-primary/20 hover:text-primary"
                                        }`}
                                    >
                                        <ThumbsUp className={`w-4 h-4 ${s.voted ? "fill-primary" : ""}`} />
                                        <span className="text-sm font-bold mt-0.5">{s.upvotes}</span>
                                    </button>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h2 className="font-medium text-foreground">
                                                <Link href={`/suggestions/${s.id}`} className="hover:text-primary transition-colors">
                                                    {s.title}
                                                </Link>
                                            </h2>
                                            <span className={`text-xs px-2 py-0.5 rounded ${badgeClass(s.status)}`}>
                                                {statusLabel(t, s.status)}
                                            </span>
                                        </div>
                                        <p className="text-sm text-muted-foreground line-clamp-2">{plainText(s.content)}</p>
                                        <p className="text-xs text-muted-foreground mt-2">
                                            {t("submittedBy")} {s.author?.username ?? t("deletedUser")} · {formatLocalDate(s.createdAt)}
                                        </p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                    {paged.pages > 1 && (
                        <Pagination page={paged.page} pages={paged.pages} total={paged.total} onPageChange={paged.setPage} />
                    )}
                </div>
            )}
        </PageFrame>
    );
}
