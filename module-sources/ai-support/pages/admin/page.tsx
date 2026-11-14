"use client";

/**
 * What the support assistant drafted and sent, newest first.
 *
 * Each row says what became of an answer and how sure the model was, and
 * opens the ticket it was for, where a waiting draft can be used or set aside.
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Settings } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Badge, Card, CardContent, ListControls, Pagination, buttonClassName, useLocalDateTime, type BadgeTone } from "@/core/sdk/ui";
import { AdminPageHeader } from "@/core/sdk/admin";

interface DraftRow {
    id: string;
    ticketId: string;
    status: string;
    reply: string;
    canAnswer: boolean;
    confidence: number | null;
    error: string | null;
    createdAt: string;
}

const STATUSES = ["draft", "sent", "used", "discarded", "stale", "failed"] as const;

const TONES: Record<string, BadgeTone> = {
    draft: "info",
    sent: "success",
    used: "success",
    discarded: "neutral",
    stale: "neutral",
    failed: "danger",
};

export default function AiSupportLogPage() {
    const t = useTranslations("aiSupport");
    const when = useLocalDateTime();
    const [status, setStatus] = useState("");
    const [rows, setRows] = useState<DraftRow[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        const params = new URLSearchParams({ page: String(page) });
        if (status) params.set("status", status);
        try {
            const res = await fetch(`/api/v1/ai-support/admin/drafts?${params}`);
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setRows(data.drafts ?? []);
            setPages(Math.max(1, Math.ceil((data.total ?? 0) / (data.limit ?? 50))));
        } catch {
            toast.error(t("log_loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [page, status, t]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, [load]);

    return (
        <>
            <AdminPageHeader
                title={t("log_title")}
                description={t("log_subtitle")}
                actions={
                    <Link href="/admin/ai-support/settings" className={buttonClassName("outline")}>
                        <Settings className="w-4 h-4" aria-hidden="true" /> {t("log_settings")}
                    </Link>
                }
            />
            <ListControls
                className="mb-4"
                filters={[
                    {
                        id: "status",
                        label: t("filter_status"),
                        value: status,
                        options: [{ value: "", label: t("status_all") }, ...STATUSES.map((s) => ({ value: s, label: t(`status_${s}`) }))],
                        onChange: (value: string) => {
                            setStatus(value);
                            setPage(1);
                        },
                    },
                ]}
            />
            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : rows.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">{t("log_empty")}</p>
                    ) : (
                        <ul className="divide-y divide-border">
                            {rows.map((row) => (
                                <li key={row.id} className="p-4 flex items-start gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2 mb-1">
                                            <Badge tone={TONES[row.status] ?? "neutral"}>{t(`status_${STATUSES.includes(row.status as (typeof STATUSES)[number]) ? row.status : "draft"}`)}</Badge>
                                            {row.confidence !== null && (
                                                <span className="text-xs text-muted-foreground">{t("draft_confidence", { value: row.confidence })}</span>
                                            )}
                                            <span className="text-xs text-muted-foreground">{when(row.createdAt)}</span>
                                        </div>
                                        <p className="text-sm text-muted-foreground line-clamp-2 break-words">
                                            {row.status === "failed" ? t("draft_failed") : row.reply}
                                        </p>
                                    </div>
                                    <Link href={`/admin/tickets/${row.ticketId}`} className="text-sm text-primary hover:underline shrink-0">
                                        {t("log_openTicket")}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                    <Pagination page={page} pages={pages} onPageChange={setPage} />
                </CardContent>
            </Card>
        </>
    );
}
