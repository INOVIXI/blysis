"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { Link } from "@/core/sdk/navigation";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ListControls, LoadFailed, Pagination, buttonClassName, useRowList } from "@/core/sdk/ui";
import { useRelativeTime } from "@/core/sdk/ui";
import { adminKeys, labelFor, priorityTone, PRIORITY_KEYS, statusTone, STATUS_KEYS } from "../../../lib/status-labels";
import { AdminPageHeader } from "@/core/sdk/admin";

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
    const [stats, setStats] = useState({ open: 0, inProgress: 0, waiting: 0, closed: 0 });

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
        // Fetch stats
        Promise.all([
            fetch("/api/v1/tickets?status=OPEN").then(r => r.json()),
            fetch("/api/v1/tickets?status=IN_PROGRESS").then(r => r.json()),
            fetch("/api/v1/tickets?status=WAITING_REPLY").then(r => r.json()),
            fetch("/api/v1/tickets?status=CLOSED").then(r => r.json()),
        ]).then(([open, inProgress, waiting, closed]) => {
            setStats({
                open: open.pagination?.total || 0,
                inProgress: inProgress.pagination?.total || 0,
                waiting: waiting.pagination?.total || 0,
                closed: closed.pagination?.total || 0,
            });
        }).catch(console.error);
    }, []);

    return (
        <>
            <AdminPageHeader
                title={t("adm_supportTickets")}
                description={t("adm_manageTickets")}
            />

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("OPEN")}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">{t("adm_open")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold text-primary">{stats.open}</p>
                    </CardContent>
                </Card>
                <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("IN_PROGRESS")}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">{t("adm_inProgress")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold text-warning">{stats.inProgress}</p>
                    </CardContent>
                </Card>
                <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("WAITING_REPLY")}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">{t("adm_waitingReply")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold text-secondary">{stats.waiting}</p>
                    </CardContent>
                </Card>
                <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("")}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">{t("adm_closed")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold text-muted-foreground">{stats.closed}</p>
                    </CardContent>
                </Card>
            </div>

            {/* Filter */}
            <div className="flex gap-2 mb-4">
                <Button
                    variant={statusFilter === "" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setStatusFilter("")}
                >
                    {t("adm_all")}
                </Button>
                <Button
                    variant={statusFilter === "OPEN" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setStatusFilter("OPEN")}
                >
                    {t("adm_open")}
                </Button>
                <Button
                    variant={statusFilter === "IN_PROGRESS" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setStatusFilter("IN_PROGRESS")}
                >
                    {t("adm_inProgress")}
                </Button>
                <Button
                    variant={statusFilter === "WAITING_REPLY" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setStatusFilter("WAITING_REPLY")}
                >
                    {t("adm_waitingReply")}
                </Button>
                <Button
                    variant={statusFilter === "RESOLVED" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setStatusFilter("RESOLVED")}
                >
                    {t("adm_resolved")}
                </Button>
                <Button
                    variant={statusFilter === "CLOSED" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setStatusFilter("CLOSED")}
                >
                    {t("adm_closed")}
                </Button>
            </div>

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
                                        <p className="text-xs text-muted-foreground">{ticket._count.messages} messages</p>
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
