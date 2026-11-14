"use client";

import { useState, useEffect, use } from "react";
import { Link } from "@/core/sdk/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Bot, UserRound } from "lucide-react";
import { Badge, Button, MemberAvatar, RichContent, RichTextEditor, buttonClassName } from "@/core/sdk/ui";
import { ArrangedClientPage } from "@/core/sdk/layout";
import { useRelativeTime } from "@/core/sdk/ui";
import { FIRST_STATUS, isOpenState, stateLabel, stateTone, type TicketState } from "../../../../lib/ticket-states";

interface Message {
    id: string;
    content: string;
    isStaffReply: boolean;
    /** A support assistant's, which no setting may present as a person's. */
    byAssistant?: boolean;
    createdAt: string;
    /** Null for the assistant, and for an account deleted since. */
    user: { id: string; username: string; avatar: string | null } | null;
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
    assistantPaused?: boolean;
    askedForPersonAt?: string | null;
}

interface PageProps {
    params: Promise<{ id: string }>;
}

export default function TicketDetailPage({ params }: PageProps) {
    const { id } = use(params);
    const { data: session } = useSession();
    const t = useTranslations("tickets");
    // The department and the states the operator named, in the page's language.
    const locale = useLocale();
    const relativeTime = useRelativeTime();
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
    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [asking, setAsking] = useState(false);

    useEffect(() => {
        let cancelled = false;
        if (session?.user) {
            fetch(`/api/v1/tickets/${id}?locale=${encodeURIComponent(locale)}`)
                .then((res) => {
                    // The reason is not the reader's: a 404 and a dead
                    // network both mean the ticket is not on screen.
                    if (!res.ok) throw new Error("load-failed");
                    return res.json();
                })
                .then((data) => {
                    if (cancelled) return;
                    setTicket(data);
                    if (data.states) setStates(data.states);
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
    }, [session, id, locale]);

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
                status: FIRST_STATUS,
            } : null);
            setReply("");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t("replyFailed"));
        } finally {
            setSending(false);
        }
    };

    /*
     * Asking for a person stops the assistant on this ticket. It is offered
     * once the assistant has spoken, and only the team can undo it.
     */
    const askForPerson = async () => {
        setAsking(true);
        try {
            const res = await fetch(`/api/v1/tickets/${id}/assistant`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paused: true }),
            });
            if (!res.ok) throw new Error("ask-failed");
            setTicket((prev) => prev ? { ...prev, assistantPaused: true, askedForPersonAt: new Date().toISOString() } : null);
        } catch {
            toast.error(t("assistant_askFailed"));
        } finally {
            setAsking(false);
        }
    };

    if (!session?.user) {
        return (
            <ArrangedClientPage page="tickets.ticket" frame={{ title: t("ticket"), trail: [{ label: t("support"), href: '/support' }] }} blocks={{}}>
                <div className="bg-card rounded-xl p-8 text-center">
                    <p className="text-muted-foreground mb-4">{t("loginToView")}</p>
                    <Link href="/auth/login" className={buttonClassName("default", "default")}>{t("login")}</Link>
                </div>
            </ArrangedClientPage>
        );
    }

    // Where a ticket stands is the first thing its owner came to read, so it
    // sits beside the title rather than in a card of its own below it. That
    // card held one short line across the full measure and nothing else.
    const status = ticket ? (
        <Badge tone={stateTone(ticket.status, states.statuses)}>
            {stateLabel(t, ticket.status, states.statuses)}
        </Badge>
    ) : null;

    const waiting = loading ? (
        <div className="bg-card rounded-xl p-8 text-center">
            <p className="text-muted-foreground">{t("loadingTicket")}</p>
        </div>
    ) : error ? (
        <div className="bg-card rounded-xl p-8 text-center">
            <p className="text-destructive mb-4">{error}</p>
            <Link href="/support" className={buttonClassName("outline", "default")}>{t("backToSupport")}</Link>
        </div>
    ) : null;

    if (waiting || !ticket) {
        return (
            <ArrangedClientPage
                page="tickets.ticket"
                frame={{ title: ticket?.subject ?? t("ticket"), trail: [{ label: t("support"), href: '/support' }], actions: status }}
                blocks={{}}
            >
                {waiting}
            </ArrangedClientPage>
        );
    }

    return (
        <ArrangedClientPage
            page="tickets.ticket"
            frame={{
                title: ticket.subject,
                trail: [{ label: t("support"), href: '/support' }],
                actions: status,
            }}
            blocks={{
                thread: () => (
                    <div className="space-y-4">
                        {/* Messages */}
                        <div className="space-y-4">
                            {ticket.messages.map((message) => (
                                <div
                                    key={message.id}
                                    className={`bg-card rounded-xl border p-4 ${message.isStaffReply
                                        ? "border-primary/20 bg-primary/50"
                                        : message.byAssistant ? "border-dashed border-border" : "border-border"
                                        }`}
                                >
                                    <div className="flex items-center gap-3 mb-3">
                                        {/* The assistant has no account and no face: an icon,
                                            never a person's avatar, and a name no setting changes. */}
                                        {message.byAssistant ? (
                                            <span className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                                                <Bot className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                                            </span>
                                        ) : message.user ? (
                                            <MemberAvatar name={message.user.username} src={message.user.avatar} size={40} />
                                        ) : (
                                            <span className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                                                <UserRound className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                                            </span>
                                        )}
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-foreground">
                                                    {message.byAssistant ? t("assistant_name") : (message.user?.username ?? t("deletedMember"))}
                                                </span>
                                                {message.isStaffReply && (
                                                    <Badge tone="info">{t("staff")}</Badge>
                                                )}
                                            </div>
                                            <span className="text-xs text-muted-foreground">{relativeTime(message.createdAt)}</span>
                                        </div>
                                    </div>
                                    <RichContent markdown={message.content} keepLineBreaks />
                                    {message.byAssistant && (
                                        <p className="mt-3 text-xs text-muted-foreground">{t("assistant_note")}</p>
                                    )}
                                </div>
                            ))}
                        </div>

                        {isOpenState(ticket.status, states.statuses) && (
                            ticket.assistantPaused && ticket.askedForPersonAt ? (
                                <p className="text-sm text-muted-foreground">{t("assistant_asked")}</p>
                            ) : !ticket.assistantPaused && ticket.messages.some((message) => message.byAssistant) ? (
                                <div className="bg-card rounded-xl border border-border p-4 flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-sm text-muted-foreground">{t("assistant_askPersonHint")}</p>
                                    <Button variant="outline" onClick={askForPerson} disabled={asking}>
                                        <UserRound className="w-4 h-4" aria-hidden="true" /> {t("assistant_askPerson")}
                                    </Button>
                                </div>
                            ) : null
                        )}

                        {/* Reply Form */}
                        {/* Still open, by the state rather than by one name. */}
                        {isOpenState(ticket.status, states.statuses) && (
                            <div className="bg-card rounded-xl border border-border p-4">
                                <form onSubmit={handleReply}>
                                    {/* The same editor the staff
                                        answer with. A reply typed as
                                        plain text is still valid
                                        Markdown, so a member who
                                        ignores the toolbar loses
                                        nothing. */}
                                    <div className="mb-3">
                                        <RichTextEditor
                                            value={reply}
                                            onChange={setReply}
                                            placeholder={t("replyPlaceholder")}
                                            minHeight="8rem"
                                        />
                                    </div>
                                    <Button type="submit" disabled={sending || !reply.trim()}>
                                        {sending ? t("sending") : t("sendReply")}
                                    </Button>
                                </form>
                            </div>
                        )}
                    </div>
                ),
                details: () => (
                    <div className="space-y-4">
                        <div className="bg-card rounded-xl border border-border p-4">
                            <h2 className="font-bold text-foreground mb-3">{t("ticketInfo")}</h2>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between gap-3">
                                    <span className="text-muted-foreground">{t("priority")}</span>
                                    <Badge tone={stateTone(ticket.priority, states.priorities)}>
                                        {stateLabel(t, ticket.priority, states.priorities)}
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
                ),
            }}
        />
    );
}
