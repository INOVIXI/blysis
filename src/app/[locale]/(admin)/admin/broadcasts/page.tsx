"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Pagination, usePagedRows } from "@/core/components/ui/pagination";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { RichTextEditor } from "@/core/components/ui/rich-text-editor";
import { Send, Loader2, Trash2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { useTranslations } from "next-intl";
import { writeError } from "@/core/lib/write-result";
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
    const paged = usePagedRows(broadcasts);
    const [loading, setLoading] = useState(true);
    const [composing, setComposing] = useState(false);
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
            const res = await fetch("/api/v1/broadcasts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    subject,
                    body,
                    filter: { all: true },
                    sendNow,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                toast.success(
                    sendNow
                        ? (t("broadcasts_queuedToast", { count: data.queuedRecipients }))
                        : (t("broadcasts_draftSaved")),
                );
                setSubject(""); setBody(""); setComposing(false);
                fetchBroadcasts();
            } else {
                toast.error(t("broadcasts_sendFailed"));
            }
        } finally {
            setSending(false);
        }
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

    return (
        <>
            <AdminPageHeader
                title={t("sidebar_broadcasts")}
                description={t("settings_broadcastsDesc")}
                actions={<>
                    <Button
                        variant={composing ? "outline" : "default"}
                        onClick={() => setComposing(!composing)}
                    >
                        {composing ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        {composing ? commonT("cancel") : t("common_new")}
                    </Button>
                </>}
            />

            {composing && (
                <Card className="mb-6">
                    <CardHeader>
                        <CardTitle>{t("broadcasts_newBroadcast")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <Label>{t("broadcasts_subject")}</Label>
                            <Input aria-label={t("broadcasts_subject")} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("broadcasts_subjectPlaceholder")} />
                        </div>
                        <div>
                            <Label>{t("broadcasts_body")}</Label>
                            <RichTextEditor value={body} onChange={setBody} placeholder="Hello {username}, ..." />
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
            )}

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : broadcasts.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">{t("broadcasts_noBroadcasts")}</CardContent></Card>
            ) : (
                <div className="space-y-2">
                    {paged.rows.map((b) => (
                        <Card key={b.id}>
                            <CardContent className="p-4 flex items-center gap-4">
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
                                    <Button aria-label={commonT("delete")} variant="ghost" size="sm" className="text-destructive" onClick={() => deleteBroadcast(b)}>
                                        <Trash2 className="w-3 h-3" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                    <Pagination
                        page={paged.page}
                        pages={paged.pages}
                        total={paged.total}
                        onPageChange={paged.setPage}
                        className="border-t-0"
                    />
                </div>
            )}
        </>
    );
}
