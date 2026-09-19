"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect, use } from "react";
import { Link } from "@/core/sdk/navigation";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Textarea, NativeSelect, buttonClassName, useLocalDate, useLocalDateTime } from "@/core/sdk/ui";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { adminKeys, labelFor, priorityTone, PRIORITY_KEYS, statusTone, STATUS_KEYS } from "../../../../lib/status-labels";
import { toast } from "sonner";
import { writeError } from "@/core/sdk";
import { AdminPageHeader } from "@/core/sdk/admin";

/** The admin catalogue's copy of the status labels. */
const ADMIN_STATUS_KEYS = adminKeys(STATUS_KEYS);

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

const statusOptions = ["OPEN", "IN_PROGRESS", "WAITING_REPLY", "RESOLVED", "CLOSED"];
const priorityOptions = ["LOW", "MEDIUM", "HIGH", "URGENT"];

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
                    by {ticket.user.username} · {formatDate(ticket.createdAt)}
                </>}
                backHref="/admin/tickets"
                backLabel={commonT("back")}
            />

            <div className="grid lg:grid-cols-3 gap-8">
                {/* Messages */}
                <div className="lg:col-span-2 space-y-4">
                    {ticket.messages.map((msg) => (
                        <Card key={msg.id} className={msg.isStaffReply ? "border-l-4 border-l-blue-500" : ""}>
                            <CardContent className="p-4">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                                        {msg.user.username[0].toUpperCase()}
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium">
                                            {msg.user.username}
                                            {msg.isStaffReply && (
                                                <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">{t("staff")}</span>
                                            )}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {formatDateTime(msg.createdAt)}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-sm text-foreground whitespace-pre-wrap">{msg.content}</div>
                            </CardContent>
                        </Card>
                    ))}

                    {/* Reply Form */}
                    {ticket.status !== "CLOSED" && (
                        <Card>
                            <CardContent className="p-4">
                                <Textarea
                                    value={replyContent}
                                    onChange={(e) => setReplyContent(e.target.value)}
                                    placeholder={t("adm_writeReply")} aria-label={t("adm_writeReply")}
                                    rows={4}
                                    className="mb-3"
                                />
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
                                    {statusOptions.map((s) => (
                                        <option key={s} value={s}>{s.replace("_", " ")}</option>
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
                                    {priorityOptions.map((p) => (
                                        <option key={p} value={p}>{p}</option>
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
                                <span className="text-muted-foreground">{t("adm_status")}</span>
                                <Badge tone={statusTone(ticket.status)}>{labelFor(t, ADMIN_STATUS_KEYS, ticket.status)}</Badge>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{t("adm_priority")}</span>
                                <Badge tone={priorityTone(ticket.priority)}>{labelFor(t, PRIORITY_KEYS, ticket.priority)}</Badge>
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
