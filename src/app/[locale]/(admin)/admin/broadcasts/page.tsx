"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Pagination } from "@/core/components/ui/pagination";
import { ListControls } from "@/core/components/ui/list-controls";
import { Checkbox } from "@/core/components/ui/checkbox";
import { BulkBar } from "@/core/components/admin/BulkBar";
import { RowActions } from "@/core/components/admin/RowActions";
import { deleteEach } from "@/core/lib/bulk-delete";
import { useRowList } from "@/core/hooks/useRowList";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { RichTextEditor } from "@/core/components/ui/rich-text-editor";
import { Send, Loader2, Trash2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { useTranslations } from "next-intl";
import { writeError } from "@/core/lib/write-result";
import { useFormRoute } from "@/core/hooks/useFormRoute";
import { Link } from "@/core/lib/i18n/navigation";
import { buttonClassName } from "@/core/components/ui/button";
import { badgeClassName, type BadgeTone } from "@/core/components/ui/badge";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { useLocalDateTime } from "@/core/hooks/useLocalDate";

interface Broadcast {
    id: string;
    subject: string;
    body: string;
    status: string;
    totalCount: number;
    sentCount: number;
    failedCount: number;
    createdAt: string;
    completedAt: string | null;
}

export default function BroadcastsPage() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDateTime = useLocalDateTime();
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
    // The lines the card draws. Every one of these lists grows, and
    // paging to a row was the only way to reach it.
    const list = useRowList(broadcasts, { text: (b) => [b.subject], pageSize: 12 });
    const [loading, setLoading] = useState(true);
    /*
     * The composer is a place, not a card that unfolds over the list.
     *
     * It used to be a flag: the browser's back button did not close it, a
     * half-written message could not be reloaded or linked, and the same
     * address was two screens. `?form=new` writes a new one and
     * `?form=<id>` picks a draft back up.
     */
    const { showForm, editingId, formHref, closeForm } = useFormRoute();
    const [subject, setSubject] = useState("");
    const [body, setBody] = useState("");
    const [sending, setSending] = useState(false);
    const { confirm } = useConfirm();

    const fetchBroadcasts = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/v1/broadcasts");
            const data = await res.json();
            setBroadcasts(data.broadcasts || []);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchBroadcasts(); }, []);

    /*
     * The draft being edited, read once its row has arrived. A composer
     * opened straight from an address has no rows yet, so this waits for
     * them rather than asking the endpoint a second time.
     */
    useEffect(() => {
        if (!editingId) { setSubject(""); setBody(""); return; }
        const draft = broadcasts.find((row) => row.id === editingId);
        if (draft) { setSubject(draft.subject); setBody(draft.body); }
    }, [editingId, broadcasts]);

    const send = async (sendNow: boolean) => {
        if (!subject.trim() || !body.trim()) {
            toast.error(t("broadcasts_subjectRequired"));
            return;
        }
        if (sendNow) {
            const ok = await confirm({
                title: t("broadcasts_sendTitle"),
                message: t("broadcasts_sendConfirm"),
                variant: "danger",
                confirmText: t("broadcasts_sendNow"),
            });
            if (!ok) return;
        }

        setSending(true);
        try {
            /*
             * A draft that is being corrected is written back before it is
             * sent, or the send would queue what was saved rather than what
             * is on screen.
             */
            if (editingId) {
                const saved = await fetch(`/api/v1/broadcasts/${editingId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ subject, body }),
                });
                if (!saved.ok) {
                    toast.error(await writeError(saved, t("broadcasts_sendFailed"), t) ?? t("broadcasts_sendFailed"));
                    return;
                }
                if (!sendNow) {
                    toast.success(t("broadcasts_draftSaved"));
                    closeForm();
                    fetchBroadcasts();
                    return;
                }
            }

            /*
             * One request either way: a draft that already exists is queued
             * by its own address, and a new one is written and queued in the
             * same call. Chosen before it is sent rather than inside the
             * call, so there is one answer to look at.
             */
            const request = editingId
                ? { url: `/api/v1/broadcasts/${editingId}`, init: { method: "POST" } as RequestInit }
                : {
                    url: "/api/v1/broadcasts",
                    init: {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ subject, body, filter: { all: true }, sendNow }),
                    } as RequestInit,
                };
            const res = await fetch(request.url, request.init);
            if (res.ok) {
                const data = await res.json();
                toast.success(
                    sendNow
                        ? (t("broadcasts_queuedToast", { count: data.queuedRecipients }))
                        : (t("broadcasts_draftSaved")),
                );
                setSubject(""); setBody(""); closeForm();
                fetchBroadcasts();
            } else {
                toast.error(t("broadcasts_sendFailed"));
            }
        } finally {
            setSending(false);
        }
    };

    const deleteMany = async () => {
        const ok = await confirm({
            title: t("broadcasts_deleteTitle"),
            message: t("crud_deleteItemsConfirm", { count: list.picked.size }),
            variant: "danger",
            confirmText: commonT("delete"),
        });
        if (!ok) return;
        const { deleted, total } = await deleteEach([...list.picked], async (id) => {
            const res = await fetch(`/api/v1/broadcasts/${id}`, { method: "DELETE" });
            return res.ok;
        });
        list.clear();
        fetchBroadcasts();
        if (deleted === total) toast.success(t("crud_deleted"));
        else if (deleted === 0) toast.error(t("crud_deleteFailed"));
        else toast.error(t("crud_deletedPartly", { deleted, total }));
    };

    const deleteBroadcast = async (b: Broadcast) => {
        const ok = await confirm({
            title: t("broadcasts_deleteTitle"),
            message: t("broadcasts_deleteConfirm", { subject: b.subject }),
            variant: "danger",
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/broadcasts/${b.id}`, { method: "DELETE" });
        const failed = await writeError(res, t("common_writeFailed"), t);
        if (failed) { toast.error(failed); return; }
        fetchBroadcasts();
    };

    const queueDraft = async (b: Broadcast) => {
        const ok = await confirm({
            title: t("broadcasts_sendTitle"),
            message: t("broadcasts_queueConfirm", { subject: b.subject }),
            variant: "danger",
            confirmText: t("broadcasts_sendButton"),
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/broadcasts/${b.id}`, { method: "POST" });
        const failed = await writeError(res, t("broadcasts_sendFailed"), t);
        if (failed) { toast.error(failed); return; }
        fetchBroadcasts();
    };

    // The message key per broadcast status. The chip printed the column, so
    // a Turkish admin read "queued" on the row and "Sirada" nowhere.
    const STATUS_LABEL: Record<string, string> = {
        draft: "broadcasts_draft",
        queued: "broadcasts_queued",
        sending: "broadcasts_sending",
        sent: "broadcasts_sent",
        failed: "broadcasts_failed",
    };

    const STATUS_TONE: Record<string, BadgeTone> = {
        draft: "neutral",
        queued: "info",
        sending: "warning",
        sent: "success",
        failed: "danger",
    };

    if (showForm) {
        return (
            <>
                <AdminPageHeader
                    onBack={closeForm}
                    backLabel={commonT("back")}
                    title={editingId ? t("broadcasts_editDraft") : t("broadcasts_newBroadcast")}
                    description={t("settings_broadcastsDesc")}
                />

                <Card>
                    <CardContent className="p-6 space-y-4">
                        <div>
                            <Label>{t("broadcasts_subject")}</Label>
                            <Input aria-label={t("broadcasts_subject")} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("broadcasts_subjectPlaceholder")} />
                        </div>
                        <div>
                            <Label>{t("broadcasts_body")}</Label>
                            <RichTextEditor value={body} onChange={setBody} placeholder={t("broadcasts_bodyPlaceholder")} />
                            <p className="text-xs text-muted-foreground mt-1">{t("broadcasts_usernamePlaceholder")}</p>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => send(false)} disabled={sending}>{t("broadcasts_saveDraft")}</Button>
                            <Button onClick={() => send(true)} disabled={sending}>
                                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                {t("broadcasts_sendNow")}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </>
        );
    }

    return (
        <>
            <AdminPageHeader
                title={t("sidebar_broadcasts")}
                description={t("settings_broadcastsDesc")}
                actions={
                    <Link href={formHref()} className={buttonClassName("default", "default")}>
                        <Plus className="w-4 h-4" /> {t("common_new")}
                    </Link>
                }
            />

            <ListControls className="mb-4" search={{ value: list.search, onChange: list.setSearch }} />

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : broadcasts.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">{t("broadcasts_noBroadcasts")}</CardContent></Card>
            ) : (
                <div className="space-y-2">
                    <BulkBar
                        className="rounded-lg border border-border"
                        state={list.headerState}
                        count={list.picked.size}
                        onToggleAll={list.toggleAll}
                        actions={
                            <Button variant="destructive" size="sm" onClick={deleteMany}>
                                <Trash2 className="w-4 h-4" /> {commonT("delete")} {list.picked.size}
                            </Button>
                        }
                    />
                    {list.rows.map((b) => (
                        <Card key={b.id}>
                            <CardContent className="p-4 flex items-center gap-4">
                                <Checkbox
                                    checked={list.picked.has(b.id)}
                                    onChange={() => list.toggle(b.id)}
                                    aria-label={t("common_selectRow")}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h2 className="font-medium text-foreground truncate">{b.subject}</h2>
                                        <span className={badgeClassName(STATUS_TONE[b.status] ?? "neutral", "uppercase font-mono")}>
                                            {STATUS_LABEL[b.status] && t.has(STATUS_LABEL[b.status]) ? t(STATUS_LABEL[b.status]) : b.status}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {formatDateTime(b.createdAt)}
                                        {b.totalCount > 0 && (
                                            <span className="ml-2">
                                                {t("broadcasts_sentSuffix", { sent: b.sentCount, total: b.totalCount })}
                                                {b.failedCount > 0 && <span className="text-destructive"> {t("broadcasts_failedSuffix", { failed: b.failedCount })}</span>}
                                            </span>
                                        )}
                                    </p>
                                </div>
                                <div className="flex gap-1">
                                    {b.status === "draft" && (
                                        <Button variant="outline" size="sm" onClick={() => queueDraft(b)}>
                                            <Send className="w-3 h-3" /> {t("broadcasts_sendButton")}
                                        </Button>
                                    )}
                                    <RowActions
                                        actions={[
                                            // Only a draft: a queued one is
                                            // being walked by the sender and a
                                            // sent one is a record.
                                            {
                                                icon: Pencil,
                                                label: commonT("edit"),
                                                href: formHref(b.id),
                                                hidden: b.status !== "draft",
                                            },
                                            { icon: Trash2, label: commonT("delete"), onClick: () => deleteBroadcast(b), destructive: true },
                                        ]}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                    <Pagination
                        page={list.page}
                        pages={list.pages}
                        total={list.total}
                        onPageChange={list.setPage}
                        className="border-t-0"
                    />
                </div>
            )}
        </>
    );
}
