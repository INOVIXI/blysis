"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect, use } from "react";
import { Link } from "@/core/sdk/navigation";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, MemberAvatar, RichContent, RichTextEditor, NativeSelect, buttonClassName, useLocalDate, useLocalDateTime } from "@/core/sdk/ui";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { isOpenState, stateLabel, stateTone, type TicketState } from "../../../../lib/ticket-states";
import { toast } from "sonner";
import { writeError } from "@/core/sdk";
import { AdminPageHeader } from "@/core/sdk/admin";

/** The admin catalogue's copy of the status labels. */

interface Message {
    id: string;
    content: string;
    isStaffReply: boolean;
    createdAt: string;
    user: {
        id: string;
        username: string;
        avatar: string | null;
    };
}

interface Ticket {
    id: string;
    subject: string;
    status: string;
    priority: string;
    createdAt: string;
    department: { id: string; name: string; color: string | null };
    user: { id: string; username: string; avatar: string | null };
    assignedTo: { id: string; username: string } | null;
    messages: Message[];
}

// The two lists are the desk's own now, so a state an operator added is one
// this screen offers without anybody editing it.

interface PageProps {
    params: Promise<{ id: string; locale: string }>;
}

export default function AdminTicketDetailPage(props: PageProps) {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const formatDateTime = useLocalDateTime();
    const t = useTranslations("tickets");
    const commonT = useTranslations("common");
    const params = use(props.params);
    const ticketId = params.id;

    const [ticket, setTicket] = useState<Ticket | null>(null);
    /*
     * The words come with the ticket. States are rows an operator writes
     * now, so one they added has no key in any catalogue - only the row
     * knows what it is called.
     */
    const [states, setStates] = useState<{ statuses: TicketState[]; priorities: TicketState[] }>(
        { statuses: [], priorities: [] },
    );
    const [loading, setLoading] = useState(true);
    const [replyContent, setReplyContent] = useState("");
    const [sending, setSending] = useState(false);
    const [updating, setUpdating] = useState(false);

    const fetchTicket = async () => {
        try {
            const res = await fetch(`/api/v1/tickets/${ticketId}`);
            if (res.ok) {
                const data = await res.json();
                setTicket(data);
                if (data.states) setStates(data.states);
            }
        } catch (err) {
            console.error("Failed to fetch ticket:", err);
        } finally {
            setLoading(false);
        }
    };

    /* eslint-disable react-hooks/exhaustive-deps */
    useEffect(() => {
        fetchTicket();
    }, [ticketId]);
    /* eslint-enable react-hooks/exhaustive-deps */

    const sendReply = async () => {
        if (!replyContent.trim()) return;
        setSending(true);
        try {
            const res = await fetch(`/api/v1/tickets/${ticketId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: replyContent, ticketId }),
            });
            if (res.ok) {
                setReplyContent("");
                fetchTicket();
            }
        } catch (err) {
            console.error("Failed to send reply:", err);
        } finally {
            setSending(false);
        }
    };

    const updateTicket = async (field: string, value: string) => {
        setUpdating(true);
        try {
            const res = await fetch(`/api/v1/tickets/${ticketId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [field]: value }),
            });
            const failed = await writeError(res, t("adm_writeFailed"), t);
            if (failed) { toast.error(failed); return; }
            fetchTicket();
        } catch (err) {
            console.error("Failed to update ticket:", err);
        } finally {
            setUpdating(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!ticket) {
        return (
            <div className="text-center py-12">
                <p className="text-muted-foreground">{t("adm_ticketNotFound")}</p>
                <Link href="/admin/tickets" className={buttonClassName("outline", "default", "mt-4")}>{t("adm_backToTickets")}</Link>
            </div>
        );
    }

    return (
        <>
            <AdminPageHeader
                title={ticket.subject}
                description={<>
                    {t("adm_openedBy", { name: ticket.user.username, date: formatDate(ticket.createdAt) })}
                </>}
                backHref="/admin/tickets"
                backLabel={commonT("back")}
            />

            <div className="grid lg:grid-cols-3 gap-8">
                {/* Messages */}
                <div className="lg:col-span-2 space-y-4">
                    {ticket.messages.map((msg) => (
                        /*
                         * A staff answer is tinted rather than ruled.
                         *
                         * It used to carry a four pixel stripe in `blue-500`,
                         * so a theme that is not blue got a blue bar down
                         * every answer - the forum's opening post had the
                         * same mark and lost it for the same reason. The tint
                         * is a token, so it follows the theme, and it colours
                         * the whole card rather than one edge of it, which is
                         * what tells two sides of a conversation apart at a
                         * glance.
                         */
                        <Card key={msg.id} className={msg.isStaffReply ? "bg-primary/5 border-primary/30" : ""}>
                            <CardContent className="p-4">
                                <div className="flex items-center gap-3 mb-3">
                                    <MemberAvatar name={msg.user.username} src={msg.user.avatar} size={32} />
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{msg.user.username}</span>
                                            {msg.isStaffReply && <Badge tone="info">{t("staff")}</Badge>}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {formatDateTime(msg.createdAt)}
                                        </p>
                                    </div>
                                </div>
                                <RichContent className="text-sm" markdown={msg.content} keepLineBreaks />
                            </CardContent>
                        </Card>
                    ))}

                    {/*
                      * A closed ticket has no reply box, and used to say
                      * nothing about why: the conversation simply ended and
                      * the page looked like it had lost a control.
                      */}
                    {/* Finished, by the state rather than by one name. */}
                    {!isOpenState(ticket.status, states.statuses) ? (
                        <Card>
                            <CardContent className="p-4 text-sm text-muted-foreground">
                                {t("adm_closedNoReply")}
                            </CardContent>
                        </Card>
                    ) : (
                        <Card>
                            <CardContent className="p-4">
                                {/* What a person writes is Markdown, which is
                                    already true of an article, a forum post
                                    and a suggestion. A reply was the one
                                    written thing on the site typed into a
                                    bare box and printed back verbatim. */}
                                <RichTextEditor
                                    value={replyContent}
                                    onChange={setReplyContent}
                                    placeholder={t("adm_writeReply")}
                                    minHeight="8rem"
                                />
                                <p className="mt-1 mb-3 text-xs text-muted-foreground">{t("adm_replyIsMarkdown")}</p>
                                <Button onClick={sendReply} disabled={sending || !replyContent.trim()}>
                                    {sending ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_sending")}</>
                                    ) : (
                                        <><Send className="w-4 h-4" /> {t("adm_sendReply")}</>
                                    )}
                                </Button>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("adm_details")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <label className="text-sm text-muted-foreground block mb-1">{t("adm_status")}</label>
                                <NativeSelect
                                    aria-label={t("adm_status")}
                                    value={ticket.status}
                                    onChange={(e) => updateTicket("status", e.target.value)}
                                    disabled={updating} className="w-full"
                                >
                                    {/* The name, not the column. The card
                                        below said "Kapatıldı" while this said
                                        CLOSED, ten centimetres apart, and the
                                        helper that names one was already
                                        imported for the other. */}
                                    {states.statuses.map(({ key: s }) => (
                                        <option key={s} value={s}>{stateLabel(t, s, states.statuses)}</option>
                                    ))}
                                </NativeSelect>
                            </div>
                            <div>
                                <label className="text-sm text-muted-foreground block mb-1">{t("adm_priority")}</label>
                                <NativeSelect
                                    aria-label={t("adm_priority")}
                                    value={ticket.priority}
                                    onChange={(e) => updateTicket("priority", e.target.value)}
                                    disabled={updating} className="w-full"
                                >
                                    {states.priorities.map(({ key: p }) => (
                                        <option key={p} value={p}>{stateLabel(t, p, states.priorities)}</option>
                                    ))}
                                </NativeSelect>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>{t("adm_info")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{t("adm_department")}</span>
                                <span>{ticket.department.name}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{t("adm_assignedTo")}</span>
                                <span>{ticket.assignedTo?.username || t("adm_unassigned")}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{t("adm_messages")}</span>
                                <span>{ticket.messages.length}</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </>
    );
}
