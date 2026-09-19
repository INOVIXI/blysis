"use client";

import { useState, useEffect, use } from "react";
import { Link } from "@/core/sdk/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge, Button, Textarea, buttonClassName } from "@/core/sdk/ui";
import { PageFrame, StandardSidebarLayout } from "@/core/sdk/layout";
import { useRelativeTime } from "@/core/sdk/ui";
import { labelFor, priorityTone, PRIORITY_KEYS, statusTone, STATUS_KEYS } from "../../../../lib/status-labels";

interface Message {
    id: string;
    content: string;
    isStaffReply: boolean;
    createdAt: string;
    user: { id: string; username: string; avatar: string | null };
}

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
    messages: Message[];
}

interface PageProps {
    params: Promise<{ id: string }>;
}

export default function TicketDetailPage({ params }: PageProps) {
    const { id } = use(params);
    const { data: session } = useSession();
    const t = useTranslations("tickets");
    const relativeTime = useRelativeTime();
    const [ticket, setTicket] = useState<Ticket | null>(null);
    const [loading, setLoading] = useState(true);
    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        if (session?.user) {
            fetch(`/api/v1/tickets/${id}`)
                .then((res) => {
                    // The reason is not the reader's: a 404 and a dead
                    // network both mean the ticket is not on screen.
                    if (!res.ok) throw new Error("load-failed");
                    return res.json();
                })
                .then((data) => {
                    if (cancelled) return;
                    setTicket(data);
                    setLoading(false);
                })
                .catch((err) => {
                    if (cancelled) return;
                    setError(t("ticketLoadFailed"));
                    setLoading(false);
                });
        } else {
            setLoading(false);
        }
        return () => { cancelled = true; };
    }, [session, id]);

    const handleReply = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!reply.trim()) return;

        setSending(true);
        try {
            const res = await fetch(`/api/v1/tickets/${id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: reply }),
            });

            if (!res.ok) throw new Error("Failed to send reply");

            const message = await res.json();
            setTicket((prev) => prev ? {
                ...prev,
                messages: [...prev.messages, message],
                status: "OPEN",
            } : null);
            setReply("");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t("replyFailed"));
        } finally {
            setSending(false);
        }
    };

    if (!session?.user) {
        return (
            <PageFrame
                title={t("ticket")}
                trail={[{ label: t("support"), href: '/support' }]}
            >
                <div className="bg-card rounded-xl p-8 text-center">
                    <p className="text-muted-foreground mb-4">{t("loginToView")}</p>
                    <Link href="/auth/login" className={buttonClassName("default", "default")}>{t("login")}</Link>
                </div>
            </PageFrame>
        );
    }

    return (
        <PageFrame
            title={ticket?.subject ?? t("ticket")}
            trail={[{ label: t("support"), href: '/support' }]}
            /* Where a ticket stands is the first thing its owner came to
               read, so it sits beside the title rather than in a card of its
               own below it. That card held one short line across the full
               measure and nothing else. */
            actions={ticket ? (
                <Badge tone={statusTone(ticket.status)}>
                    {labelFor(t, STATUS_KEYS, ticket.status)}
                </Badge>
            ) : null}
        >
            {loading ? (
                <div className="bg-card rounded-xl p-8 text-center">
                    <p className="text-muted-foreground">{t("loadingTicket")}</p>
                </div>
            ) : error ? (
                <div className="bg-card rounded-xl p-8 text-center">
                    <p className="text-destructive mb-4">{error}</p>
                    <Link href="/support" className={buttonClassName("outline", "default")}>{t("backToSupport")}</Link>
                </div>
            ) : ticket ? (
                <StandardSidebarLayout sidebar={(
                            <div className="space-y-4">
                                <div className="bg-card rounded-xl border border-border p-4">
                                    <h2 className="font-bold text-foreground mb-3">{t("ticketInfo")}</h2>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between gap-3">
                                            <span className="text-muted-foreground">{t("priority")}</span>
                                            <Badge tone={priorityTone(ticket.priority)}>
                                                {labelFor(t, PRIORITY_KEYS, ticket.priority)}
                                            </Badge>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <span className="text-muted-foreground">{t("department")}</span>
                                            <span className="text-foreground text-right">{ticket.department.name}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">{t("createdAt")}</span>
                                            <span className="text-foreground">{relativeTime(ticket.createdAt)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">{t("updatedAt")}</span>
                                            <span className="text-foreground">{relativeTime(ticket.updatedAt)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">{t("messages")}</span>
                                            <span className="text-foreground">{ticket.messages.length}</span>
                                        </div>
                                        {ticket.assignedTo && (
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">{t("assignedTo")}</span>
                                                <span className="text-foreground">{ticket.assignedTo.username}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}>
                    {(
                            <div className="space-y-4">
                                {/* Messages */}
                                <div className="space-y-4">
                                    {ticket.messages.map((message) => (
                                        <div
                                            key={message.id}
                                            className={`bg-card rounded-xl border p-4 ${message.isStaffReply
                                                ? "border-primary/20 bg-primary/50"
                                                : "border-border"
                                                }`}
                                        >
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground font-bold">
                                                    {message.user.avatar ? (
                                                        <>{/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img src={message.user.avatar} alt="" className="w-full h-full rounded-full object-cover" /></>
                                                    ) : (
                                                        message.user.username.charAt(0).toUpperCase()
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-foreground">{message.user.username}</span>
                                                        {message.isStaffReply && (
                                                            <Badge tone="info">{t("staff")}</Badge>
                                                        )}
                                                    </div>
                                                    <span className="text-xs text-muted-foreground">{relativeTime(message.createdAt)}</span>
                                                </div>
                                            </div>
                                            <div className="text-foreground whitespace-pre-wrap">{message.content}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Reply Form */}
                                {ticket.status !== "CLOSED" && (
                                    <div className="bg-card rounded-xl border border-border p-4">
                                        <form onSubmit={handleReply}>
                                            <Textarea
                                                value={reply}
                                                onChange={(e) => setReply(e.target.value)}
                                                placeholder={t("replyPlaceholder")} aria-label={t("replyPlaceholder")}
                                                rows={4}
                                                className="mb-3"
                                            />
                                            <Button type="submit" disabled={sending || !reply.trim()}>
                                                {sending ? t("sending") : t("sendReply")}
                                            </Button>
                                        </form>
                                    </div>
                                )}
                            </div>
                        )}
                </StandardSidebarLayout>
            ) : null}
        </PageFrame>
    );
}
