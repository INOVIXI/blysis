"use client";

/**
 * The delivery queue. Review is the state an admin comes here for: a server
 * took the job and never answered, so only a person can say whether it ran.
 * A decision on one line of a purchase can cover the whole purchase, so a
 * resend keeps its order.
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { Badge, type BadgeTone, Card, CardContent, ListControls, Pagination, useConfirm, useLocalDateTime } from "@/core/sdk/ui";
import { AdminPageHeader, FilterChips, RowActions } from "@/core/sdk/admin";

interface Job {
    id: string;
    command: string;
    state: string;
    playerName: string;
    referenceLabel: string | null;
    detail: string | null;
    createdAt: string;
}

type Decision = "mark-done" | "send-again" | "cancel";

/** The words of each decision, spelled out so every key is one the screen visibly reads. */
const WORDS: Record<Decision, { verb: string; title: string; confirm: string; done: string }> = {
    "send-again": { verb: "q_sendAgain", title: "q_sendAgainTitle", confirm: "q_sendAgainConfirm", done: "q_sendAgainDone" },
    "mark-done": { verb: "q_markDone", title: "q_markDoneTitle", confirm: "q_markDoneConfirm", done: "q_markDoneDone" },
    cancel: { verb: "q_cancel", title: "q_cancelTitle", confirm: "q_cancelConfirm", done: "q_cancelDone" },
};

const STATES = ["NEEDS_REVIEW", "PENDING", "CLAIMED", "FAILED", "DONE", "CANCELLED"] as const;

const TONE: Record<string, BadgeTone> = {
    NEEDS_REVIEW: "danger",
    FAILED: "danger",
    PENDING: "warning",
    CLAIMED: "info",
    DONE: "success",
    CANCELLED: "neutral",
};

/** Which decisions a person may take on a job in each state. */
const DECISIONS: Record<string, Decision[]> = {
    NEEDS_REVIEW: ["send-again", "mark-done"],
    FAILED: ["send-again", "mark-done"],
    PENDING: ["cancel"],
};

export default function QueuePage() {
    const t = useTranslations("gameConnect");
    const { confirm } = useConfirm();
    const when = useLocalDateTime();
    const [state, setState] = useState<string>("NEEDS_REVIEW");
    const [jobs, setJobs] = useState<Job[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");

    const load = useCallback(async () => {
        const query = new URLSearchParams({ page: String(page), state });
        if (search.trim()) query.set("q", search.trim());
        const res = await fetch(`/api/v1/game-connect/admin/jobs?${query}`);
        if (res.ok) {
            const data = await res.json();
            setJobs(data.jobs ?? []);
            setPages(Math.max(1, Math.ceil((data.total ?? 0) / (data.limit ?? 50))));
        } else toast.error(t("q_loadFailed"));
        setLoading(false);
    }, [page, state, search, t]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, [load]);

    const decide = async (job: Job, action: Decision) => {
        const words = WORDS[action];
        const group = await confirm({
            title: t(words.title),
            message: t(words.confirm, { command: job.command }),
            confirmText: t(words.verb),
            variant: action === "send-again" ? "default" : "danger",
        });
        if (!group) return;
        const res = await fetch(`/api/v1/game-connect/admin/jobs/${job.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, group: true }),
        });
        if (res.ok) toast.success(t(words.done));
        else toast.error(t("q_wrongState"));
        load();
    };

    const icon = { "mark-done": CheckCircle2, "send-again": RotateCcw, cancel: Ban } as const;

    return (
        <>
            <AdminPageHeader title={t("q_title")} description={t("q_subtitle")} />
            <FilterChips
                className="mb-4"
                label={t("q_state")}
                active={state}
                onSelect={(next) => { setState(next); setPage(1); }}
                chips={STATES.map((id) => ({ id, label: t(`q_state_${id}`) }))}
            />
            <ListControls className="mb-4" search={{ value: search, onChange: (term) => { setSearch(term); setPage(1); } }} />
            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : jobs.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">{t("q_empty")}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("q_command")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("q_player")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("q_for")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("q_state")}</th>
                                        <th className="text-right py-3 px-4 font-medium text-muted-foreground text-sm">{t("q_actions")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {jobs.map((job) => (
                                        <tr key={job.id} className="border-b last:border-0 hover:bg-muted/50">
                                            <td className="py-3 px-4">
                                                <code className="font-mono text-sm">{job.command}</code>
                                                {job.detail && <p className="text-xs text-muted-foreground mt-1">{job.detail}</p>}
                                                <p className="text-xs text-muted-foreground">{when(job.createdAt)}</p>
                                            </td>
                                            <td className="py-3 px-4 text-sm">{job.playerName}</td>
                                            <td className="py-3 px-4 text-sm">{job.referenceLabel ?? "-"}</td>
                                            <td className="py-3 px-4"><Badge tone={TONE[job.state] ?? "neutral"}>{t(`q_state_${job.state}`)}</Badge></td>
                                            <td className="py-3 px-4 text-right">
                                                <RowActions
                                                    actions={(DECISIONS[job.state] ?? []).map((action) => ({
                                                        icon: icon[action],
                                                        label: t(WORDS[action].verb),
                                                        onClick: () => decide(job, action),
                                                        destructive: action === "cancel",
                                                    }))}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <Pagination page={page} pages={pages} onPageChange={setPage} />
                </CardContent>
            </Card>
        </>
    );
}
