"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { Link } from "@/core/sdk/navigation";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ListControls, LoadFailed, Pagination, buttonClassName, useRowList } from "@/core/sdk/ui";
import { useRelativeTime } from "@/core/sdk/ui";
import { adminKeys, labelFor, priorityTone, PRIORITY_KEYS, statusTone, STATUS_KEYS } from "../../../lib/status-labels";
import { AdminPageHeader, FilterChips } from "@/core/sdk/admin";

/** The admin catalogue's copy of the status labels. */
const ADMIN_STATUS_KEYS = adminKeys(STATUS_KEYS);


interface Ticket {
    id: string;
    subject: string;
    status: string;
    priority: string;
    createdAt: string;
    updatedAt: string;
    department: { id: string; name: string; color: string | null };
    user: { id: string; username: string; avatar: string | null };
    assignedTo: { id: string; username: string; avatar: string | null } | null;
    _count: { messages: number };
}

export default function AdminTicketsPage() {
    const t = useTranslations("tickets");
    const commonT = useTranslations("common");
    const relativeTime = useRelativeTime();
    const [tickets, setTickets] = useState<Ticket[]>([]);
    // The lines the row draws. This list grows and paging to a row was the
    // only way to reach one.
    const list = useRowList(tickets, { text: (row) => [row.subject, row.user?.username], pageSize: 20 });
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState("");
    /*
     * One count per tab, and the strip has a tab for every status the filter
     * offers. RESOLVED had a button and no number, because the four cards
     * this replaced were written before that status existed and nobody went
     * back. A tab whose count is missing is a tab that reads as empty.
     */
    const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_REPLY", "RESOLVED", "CLOSED"] as const;
    const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = {
        OPEN: "open",
        IN_PROGRESS: "inProgress",
        WAITING_REPLY: "waitingReply",
        RESOLVED: "resolved",
        CLOSED: "closed",
    };
    const [stats, setStats] = useState<Record<string, number>>({});

    useEffect(() => {
        let cancelled = false;
        const url = statusFilter
            ? `/api/v1/tickets?status=${statusFilter}`
            : "/api/v1/tickets";

        fetch(url)
            .then((res) => { if (!res.ok) throw new Error("load failed"); return res.json(); })
            .then((data) => {
                if (cancelled) return;
                setTickets(data.tickets || []);
                setFailed(false);
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                setFailed(true);
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [statusFilter, reloadKey]);

    useEffect(() => {
        let cancelled = false;
        Promise.all(STATUSES.map((status) =>
            fetch(`/api/v1/tickets?status=${status}`)
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => [status, d === null ? null : (d?.pagination?.total ?? 0)] as const),
        )).then((pairs) => {
            // A count that could not be read is not zero. The chip leaves its
            // number out where there is none, so "we could not ask" looks
            // different from "nothing is waiting" - which is the whole reason
            // a zero is drawn rather than dropped.
            if (!cancelled) setStats(Object.fromEntries(pairs.filter(([, total]) => total !== null)));
        }).catch((err) => {
            // Blank chips are the trace a reader gets: no number is not zero.
            // The reason goes to the console because this is a second read
            // beside the list, and a toast over a list that loaded fine would
            // be telling an operator about something they are not blocked on.
            if (!cancelled) setStats({});
            console.error("ticket counts could not be read", err);
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <>
            <AdminPageHeader
                title={t("adm_supportTickets")}
                description={t("adm_manageTickets")}
            />

            {/*
              * One strip, not four cards and a row of buttons beneath them.
              * The cards were the counts and the buttons were the filter, and
              * both narrowed the same list - so the same five numbers were on
              * the screen twice, and clicking a card set a filter the buttons
              * below then disagreed about. A count with nothing waiting keeps
              * its zero, so the strip does not change width as tickets
              * arrive.
              */}
            <FilterChips
                className="mb-4"
                label={t("adm_status")}
                active={statusFilter}
                onSelect={setStatusFilter}
                chips={[
                    { id: "", label: t("adm_all") },
                    ...STATUSES.map((status) => ({
                        id: status,
                        label: t(`adm_${STATUS_LABEL[status]}`),
                        count: stats[status],
                    })),
                ]}
            />

            <ListControls className="mb-4" search={{ value: list.search, onChange: list.setSearch }} />

            {/* Tickets Table */}
            {loading ? (
                <div className="bg-card rounded-lg p-8 text-center">
                    <p className="text-muted-foreground">{t("adm_loading")}</p>
                </div>
            ) : failed ? (
                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
            ) : list.rows.length === 0 ? (
                <div className="bg-card rounded-lg p-8 text-center">
                    <p className="text-muted-foreground">
                        {list.search.trim() === "" ? t("adm_noTicketsFound") : commonT("noResults")}
                    </p>
                </div>
            ) : (
                <div className="bg-card rounded-lg overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t("adm_subject")}</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t("adm_user")}</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t("adm_department")}</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t("adm_status")}</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t("adm_priority")}</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t("adm_updated")}</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t("adm_actions")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.rows.map((ticket) => (
                                <tr key={ticket.id} className="hover:bg-muted/30">
                                    <td className="px-4 py-4">
                                        <Link href={`/admin/tickets/${ticket.id}`} className="text-primary hover:underline font-medium">
                                            {ticket.subject}
                                        </Link>
                                        {/* English, on a Turkish page, and "1 messages" in either. */}
                                        <p className="text-xs text-muted-foreground">{t("adm_messageCount", { count: ticket._count.messages })}</p>
                                    </td>
                                    <td className="px-4 py-4 text-sm">
                                        {ticket.user.username}
                                    </td>
                                    <td className="px-4 py-4 text-sm">
                                        {ticket.department.name}
                                    </td>
                                    <td className="px-4 py-4">
                                        <Badge tone={statusTone(ticket.status)}>{labelFor(t, ADMIN_STATUS_KEYS, ticket.status)}</Badge>
                                    </td>
                                    <td className="px-4 py-4">
                                        <Badge tone={priorityTone(ticket.priority)}>{labelFor(t, PRIORITY_KEYS, ticket.priority)}</Badge>
                                    </td>
                                    <td className="px-4 py-4 text-sm text-muted-foreground">
                                        {relativeTime(ticket.updatedAt)}
                                    </td>
                                    <td className="px-4 py-4">
                                        <Link href={`/admin/tickets/${ticket.id}`} className={buttonClassName("ghost", "sm")}>{t("adm_view")}</Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <Pagination
                        page={list.page}
                        pages={list.pages}
                        total={list.total}
                        onPageChange={list.setPage}
                    />
                </div>
            )}
        </>
    );
}
