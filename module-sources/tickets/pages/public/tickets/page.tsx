"use client";

import { useState, useEffect } from "react";
import { Link } from "@/core/sdk/navigation";
import { useSession } from "next-auth/react";
import { Badge, LoadFailed, Pagination, buttonClassName, usePagedRows } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { useRelativeTime } from "@/core/sdk/ui";
import { stateLabel, stateTone, type TicketState } from "../../../lib/ticket-states";
import { useTranslations } from "next-intl";

interface Ticket {
    id: string;
    subject: string;
    status: string;
    priority: string;
    createdAt: string;
    updatedAt: string;
    department: { id: string; name: string; color: string | null };
    _count: { messages: number };
}

export default function SupportPage() {
    const { data: session } = useSession();
    const t = useTranslations('tickets');
    const relativeTime = useRelativeTime();
    /*
     * The words come with the tickets. They are rows an operator writes now,
     * so a state they added has no key in any catalogue - only the row knows
     * what it is called.
     */
    const [states, setStates] = useState<{ statuses: TicketState[]; priorities: TicketState[] }>(
        { statuses: [], priorities: [] },
    );
    const statusLabel = (status: string) => stateLabel(t, status, states.statuses);
    const priorityLabel = (priority: string) => stateLabel(t, priority, states.priorities);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const paged = usePagedRows(tickets, 15);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        if (session?.user) {
            fetch("/api/v1/tickets")
                .then((res) => { if (!res.ok) throw new Error("load failed"); return res.json(); })
                .then((data) => {
                    if (cancelled) return;
                    setTickets(data.tickets || []);
                    if (data.states) setStates(data.states);
                    setFailed(false);
                    setLoading(false);
                })
                .catch(() => {
                if (cancelled) return;
                setFailed(true);
                setLoading(false);
            });
        } else {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLoading(false);
        }
        return () => { cancelled = true; };
    }, [session, reloadKey]);

    return (
        <PageFrame
            title={t('myTickets')}
            trail={[{ label: t('title'), href: '/support' }]}
            actions={session?.user ? (
                <Link href="/support/new" className={buttonClassName("default", "default")}>{t('newTicket')}</Link>
            ) : null}
        >
            {!session?.user ? (
                <div className="bg-card rounded-xl p-8 text-center">
                    <p className="text-muted-foreground mb-4">{t('loginRequired')}</p>
                    <Link href="/auth/login" className={buttonClassName("default", "default")}>{t('login')}</Link>
                </div>
            ) : loading ? (
                <div className="bg-card rounded-xl p-8 text-center">
                    <p className="text-muted-foreground">{t('loadingTickets')}</p>
                </div>
            ) : failed ? (
                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
            ) : tickets.length === 0 ? (
                <div className="bg-card rounded-xl p-8 text-center">
                    <p className="text-muted-foreground mb-4">{t('noTicketsYet')}</p>
                    <Link href="/support/new" className={buttonClassName("default", "default")}>{t('createFirst')}</Link>
                </div>
            ) : (
                <div className="bg-card rounded-xl border border-border overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-muted">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('subject')}</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('department')}</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('status')}</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('priority')}</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('lastUpdated')}</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">{t('messages')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {paged.rows.map((ticket) => (
                                <tr key={ticket.id} className="hover:bg-muted">
                                    <td className="px-4 py-4">
                                        <Link href={`/support/${ticket.id}`} className="text-primary hover:underline font-medium">
                                            {ticket.subject}
                                        </Link>
                                    </td>
                                    <td className="px-4 py-4 text-sm text-muted-foreground">
                                        {ticket.department.name}
                                    </td>
                                    <td className="px-4 py-4">
                                        <Badge tone={stateTone(ticket.status, states.statuses)}>{statusLabel(ticket.status)}</Badge>
                                    </td>
                                    <td className="px-4 py-4">
                                        <Badge tone={stateTone(ticket.priority, states.priorities)}>{priorityLabel(ticket.priority)}</Badge>
                                    </td>
                                    <td className="px-4 py-4 text-sm text-muted-foreground">
                                        {relativeTime(ticket.updatedAt)}
                                    </td>
                                    <td className="px-4 py-4 text-sm text-muted-foreground">
                                        {ticket._count.messages}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {paged.pages > 1 && (
                        <Pagination className="p-4" page={paged.page} pages={paged.pages} total={paged.total} onPageChange={paged.setPage} />
                    )}
                </div>
            )}
        </PageFrame>
    );
}
