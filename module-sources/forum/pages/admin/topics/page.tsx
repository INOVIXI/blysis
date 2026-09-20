"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, ListControls, Pagination, useConfirm, useRowPicks } from "@/core/sdk/ui";
import { Loader2, Pin, PinOff, Lock, Unlock, Trash2, Eye, EyeOff, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useRelativeTime } from "@/core/sdk/ui";
import { deleteEach, writeError } from "@/core/sdk";
import { AdminPageHeader, BulkBar, RowActions } from "@/core/sdk/admin";

interface Topic {
    id: string;
    title: string;
    slug: string;
    isPinned: boolean;
    isLocked: boolean;
    /** `APPROVED` is on the forum; anything else is not shown to a visitor. */
    moderationState: string;
    views: number;
    createdAt: string;
    author: { id: string; username: string };
    category: { id: string; name: string; color: string | null };
    _count: { posts: number; likes: number };
}

export default function AdminForumTopicsPage() {
    const t = useTranslations("forum");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();
    const relativeTime = useRelativeTime();
    const [topics, setTopics] = useState<Topic[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    // The endpoint has taken `search` since it was written; this screen never
    // sent one, so a moderator looking for a topic paged until it appeared.
    const [search, setSearch] = useState("");
    // The endpoint pages this, so only the ticking is the screen's. Clearing
    // a spam run was one confirmation per topic.
    const picks = useRowPicks(topics);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);

    const fetchTopics = async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams({ page: String(page), limit: "20" });
            if (search.trim()) query.set("search", search.trim());
            const res = await fetch(`/api/v1/forum/topics?${query}`);
            if (res.ok) {
                const data = await res.json();
                setTopics(data.topics || []);
                setTotal(data.total || 0);
                setTotalPages(data.pages || 1);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTopics();
    }, [page, search]);  // eslint-disable-line react-hooks/exhaustive-deps

    const togglePin = async (topicId: string, isPinned: boolean) => {
        const res = await fetch(`/api/v1/forum/topics/${topicId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isPinned: !isPinned }),
        });
        const failed = await writeError(res, t("adm_writeFailed"), t);
        if (failed) { toast.error(failed); return; }
        fetchTopics();
    };

    const toggleLock = async (topicId: string, isLocked: boolean) => {
        const res = await fetch(`/api/v1/forum/topics/${topicId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isLocked: !isLocked }),
        });
        const failed = await writeError(res, t("adm_writeFailed"), t);
        if (failed) { toast.error(failed); return; }
        fetchTopics();
    };

    /*
     * Shown, or not. `moderationState` has always decided what a visitor sees
     * and the only screen that could write it was the moderation queue, which
     * lists what is waiting. A topic already approved could not be hidden at
     * all - the only way to take something down was to delete it and lose
     * what it said.
     */
    const toggleHidden = async (topicId: string, hidden: boolean) => {
        const res = await fetch(`/api/v1/forum/topics/${topicId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ moderationState: hidden ? "APPROVED" : "REJECTED" }),
        });
        const failed = await writeError(res, t("adm_writeFailed"), t);
        if (failed) { toast.error(failed); return; }
        fetchTopics();
    };

    const deleteMany = async () => {
        const ok = await confirm({
            title: t("adm_deleteTopicTitle"),
            message: t("adm_deleteManyConfirm", { count: picks.picked.size }),
            variant: "danger",
            confirmText: commonT("delete"),
        });
        if (!ok) return;
        const { deleted, total } = await deleteEach([...picks.picked], async (id) => {
            const res = await fetch(`/api/v1/forum/topics/${id}`, { method: "DELETE" });
            return res.ok;
        });
        picks.clear();
        fetchTopics();
        if (deleted === total) toast.success(t("adm_topicDeleted"));
        else if (deleted === 0) toast.error(t("adm_deleteFailed"));
        else toast.error(t("adm_deletedPartly", { deleted, total }));
    };

    const deleteTopic = async (topicId: string) => {
        const ok = await confirm({
            title: t("adm_deleteTopicTitle"),
            message: t("adm_deleteTopicConfirm"),
            confirmText: t("adm_delete"),
            variant: "danger",
        });
        if (!ok) return;
        try {
            const res = await fetch(`/api/v1/forum/topics/${topicId}`, { method: "DELETE" });
            if (!res.ok) {
                toast.error(t("adm_deleteTopicError"));
                return;
            }
            toast.success(t("adm_topicDeleted"));
            fetchTopics();
        } catch {
            toast.error(t("adm_deleteTopicError"));
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <>
            <AdminPageHeader
                title={t("adm_forumTopics")}
                description={t("adm_topicsTotal", { count: total })}
            />

            <ListControls
                className="mb-4"
                search={{ value: search, onChange: (term) => { setSearch(term); setPage(1); } }}
            />

            <Card>
                <CardHeader>
                    <CardTitle>{t("adm_allTopics")}</CardTitle>
                </CardHeader>
                <CardContent>
                    {topics.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">
                            {search.trim() === "" ? t("adm_noForumTopics") : commonT("noResults")}
                        </p>
                    ) : (
                        <>
                            {/* Outside the scrolling box, or the select-all
                                box goes sideways with the table. */}
                            <BulkBar
                                state={picks.headerState}
                                count={picks.picked.size}
                                onToggleAll={picks.toggleAll}
                                actions={
                                    <Button variant="destructive" size="sm" onClick={deleteMany}>
                                        <Trash2 className="w-4 h-4" /> {commonT("delete")} {picks.picked.size}
                                    </Button>
                                }
                            />
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr>
                                        <th className="w-10 py-3 px-4" />
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_topic")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_category")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_author")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_stats")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_status")}</th>
                                        <th className="text-right py-3 px-4 font-medium text-muted-foreground">{t("adm_actions")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {topics.map((topic) => (
                                        <tr key={topic.id} className="hover:bg-muted/50">
                                            <td className="py-3 px-4">
                                                <Checkbox
                                                    checked={picks.picked.has(topic.id)}
                                                    onChange={() => picks.toggle(topic.id)}
                                                    aria-label={t("adm_selectRow")}
                                                />
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-2">
                                                    {topic.isPinned && <Pin className="w-3 h-3 text-primary flex-shrink-0" />}
                                                    {topic.isLocked && <Lock className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
                                                    <div>
                                                        <p className="font-medium line-clamp-1">{topic.title}</p>
                                                        <p className="text-xs text-muted-foreground">{relativeTime(new Date(topic.createdAt))}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4">
                                                <span
                                                    className="text-xs px-2 py-1 rounded"
                                                    style={{
                                                        backgroundColor: (topic.category.color || "#6366f1") + "20",
                                                        color: topic.category.color || "#6366f1",
                                                    }}
                                                >
                                                    {topic.category.name}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-muted-foreground">
                                                {topic.author.username}
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                    <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{topic._count.posts}</span>
                                                    <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{topic.views}</span>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="flex gap-1">
                                                    {topic.isPinned && <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">{t("adm_pinned")}</span>}
                                                    {topic.isLocked && <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{t("adm_locked")}</span>}
                                                    {topic.moderationState !== "APPROVED" && <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{t("adm_hidden")}</span>}
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-right">
                                                {/* One shape for a row's
                                                    actions. Three ghost
                                                    buttons with an English
                                                    `title` each - "Unpin",
                                                    "Lock" - on a Turkish
                                                    page, which a screen
                                                    reader announces as the
                                                    whole of the button. */}
                                                <RowActions
                                                    actions={[
                                                        {
                                                            icon: topic.isPinned ? PinOff : Pin,
                                                            label: topic.isPinned ? t("adm_unpin") : t("adm_pin"),
                                                            onClick: () => togglePin(topic.id, topic.isPinned),
                                                        },
                                                        {
                                                            icon: topic.isLocked ? Unlock : Lock,
                                                            label: topic.isLocked ? t("adm_unlock") : t("adm_lock"),
                                                            onClick: () => toggleLock(topic.id, topic.isLocked),
                                                        },
                                                        {
                                                            icon: topic.moderationState === "APPROVED" ? EyeOff : Eye,
                                                            label: topic.moderationState === "APPROVED" ? t("adm_hide") : t("adm_show"),
                                                            onClick: () => toggleHidden(topic.id, topic.moderationState !== "APPROVED"),
                                                        },
                                                        {
                                                            icon: Trash2,
                                                            label: commonT("delete"),
                                                            onClick: () => deleteTopic(topic.id),
                                                            destructive: true,
                                                        },
                                                    ]}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        </>
                    )}

                    <Pagination page={page} pages={totalPages} onPageChange={setPage} />
                </CardContent>
            </Card>
        </>
    );
}
