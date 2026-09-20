"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { MemberAvatar } from "@/core/components/ui/MemberAvatar";
import { ListControls } from "@/core/components/ui/list-controls";
import { Pagination } from "@/core/components/ui/pagination";
import { useRelativeTime } from "@/core/hooks/useRelativeTime";
import { cn } from "@/core/lib/utils";

interface Participant {
    id: string;
    username: string;
    avatar: string | null;
}

interface ConversationListItem {
    id: string;
    title: string | null;
    participants: Participant[];
    lastMessage: { body: string; createdAt: string; authorId?: string } | null;
    lastMessageAt: string | null;
    unreadCount: number;
}

interface Message {
    id: string;
    body: string;
    createdAt: string;
    author: Participant;
}

interface Page {
    page: number;
    pages: number;
    total: number;
}

/** Conversations per page. An inbox is read a screenful at a time. */
const PER_PAGE = 10;

/**
 * A member's inbox.
 *
 * It had the pieces and none of the arrangement. A row drew the other
 * person's first letter on a grey circle while every other list on the site
 * had moved to the shared avatar; the unread count was a hard pill that sat
 * in the row whether or not anything was unread, and nothing else about a row
 * with unread messages looked any different from one without - the count was
 * the only signal, at ten pixels, at the end of the line. A thread put its
 * back button inside the heading, so the title of the screen was a control.
 * And which side a bubble sat on was worked out by elimination - "not one of
 * the other participants" - which is a guess that happens to be right in a
 * two-person thread and wrong the moment there are three.
 *
 * Now: an unread row is bold with a dot against it and the count only appears
 * when there is one, a thread is a proper header with the person in it, and a
 * bubble is mine because the author id is mine.
 */
export function MessagesTab() {
    const t = useTranslations("profile");
    const commonT = useTranslations("common");
    const { data: session } = useSession();
    const relativeTime = useRelativeTime();

    const [conversations, setConversations] = useState<ConversationListItem[]>([]);
    const [paging, setPaging] = useState<Page>({ page: 1, pages: 1, total: 0 });
    const [term, setTerm] = useState("");
    const [page, setPage] = useState(1);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [loadingList, setLoadingList] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);

    const me = session?.user?.id ?? null;
    const thread = useRef<HTMLDivElement>(null);

    /**
     * The list, as the term and the page say it should be.
     *
     * Opening a conversation reloads it to clear that thread's unread badge,
     * and it has to come back the same list the reader was looking at rather
     * than the first page of everything.
     */
    const fetchConversations = useCallback(async () => {
        setLoadingList(true);
        try {
            const query = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
            if (term) query.set("q", term);
            const res = await fetch(`/api/v1/messages?${query}`);
            const data = await res.json();
            setConversations(data.conversations || []);
            setPaging(data.pagination ?? { page: 1, pages: 1, total: 0 });
        } finally {
            setLoadingList(false);
        }
    }, [page, term]);

    useEffect(() => { fetchConversations(); }, [fetchConversations]);

    // A thread opens at its newest message, which is where a person left off.
    useEffect(() => {
        if (!loadingMessages && thread.current) {
            thread.current.scrollTop = thread.current.scrollHeight;
        }
    }, [loadingMessages, messages.length]);

    const openConversation = async (id: string) => {
        setActiveId(id);
        setLoadingMessages(true);
        try {
            const res = await fetch(`/api/v1/messages/${id}`);
            const data = await res.json();
            setMessages(data.messages || []);
            fetchConversations();
        } finally {
            setLoadingMessages(false);
        }
    };

    const sendReply = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeId || !reply.trim()) return;
        setSending(true);
        try {
            const res = await fetch(`/api/v1/messages/${activeId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ body: reply.trim() }),
            });
            if (res.ok) {
                const data = await res.json();
                setMessages((prev) => [...prev, data.message]);
                setReply("");
                fetchConversations();
            } else {
                toast.error(t("failedToSend"));
            }
        } finally {
            setSending(false);
        }
    };

    if (activeId) {
        const conversation = conversations.find((c) => c.id === activeId);
        const other = conversation?.participants[0];
        const withWhom = conversation?.participants.map((p) => p.username).join(", ") || t("conversation");

        return (
            <Card>
                <CardHeader className="flex-row items-center gap-3 space-y-0">
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label={commonT("back")}
                        onClick={() => { setActiveId(null); setMessages([]); }}
                        className="-ml-2 flex-shrink-0"
                    >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <MemberAvatar name={other?.username ?? withWhom} src={other?.avatar} size={36} />
                    <CardTitle className="min-w-0 truncate">{withWhom}</CardTitle>
                </CardHeader>
                <CardContent>
                    {loadingMessages ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <>
                            <div ref={thread} className="mb-4 max-h-96 space-y-3 overflow-y-auto pr-1">
                                {messages.map((message, index) => {
                                    const mine = message.author.id === me;
                                    // Consecutive messages from one person are one
                                    // block: repeating the face on every line turns a
                                    // conversation into a list of senders.
                                    const runsOn = messages[index - 1]?.author.id === message.author.id;
                                    return (
                                        <div
                                            key={message.id}
                                            className={cn("flex items-end gap-2", mine ? "justify-end" : "justify-start")}
                                        >
                                            {!mine && (
                                                <span className={cn("flex-shrink-0", runsOn && "invisible")}>
                                                    <MemberAvatar
                                                        name={message.author.username}
                                                        src={message.author.avatar}
                                                        size={28}
                                                    />
                                                </span>
                                            )}
                                            <div
                                                className={cn(
                                                    "max-w-[75%] rounded-2xl px-3 py-2",
                                                    mine
                                                        ? "rounded-br-sm bg-primary text-primary-foreground"
                                                        : "rounded-bl-sm bg-muted text-foreground",
                                                )}
                                            >
                                                <div className="whitespace-pre-wrap text-sm">{message.body}</div>
                                                <div
                                                    className={cn(
                                                        "mt-1 text-[10px]",
                                                        mine ? "text-primary-foreground/70" : "text-muted-foreground",
                                                    )}
                                                >
                                                    {relativeTime(message.createdAt)}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                {messages.length === 0 && (
                                    <p className="py-4 text-center text-sm text-muted-foreground">{t("noMessagesYet")}</p>
                                )}
                            </div>
                            <form onSubmit={sendReply} className="flex gap-2">
                                <Input
                                    value={reply}
                                    onChange={(e) => setReply(e.target.value)}
                                    placeholder={t("typeAMessage")}
                                    aria-label={t("typeAMessage")}
                                    disabled={sending}
                                    className="flex-1"
                                />
                                <Button aria-label={commonT("send")} type="submit" disabled={sending || !reply.trim()}>
                                    {sending
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : <Send className="h-4 w-4" aria-hidden="true" />}
                                </Button>
                            </form>
                        </>
                    )}
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("messagesTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <ListControls
                    search={{
                        value: term,
                        onChange: (value) => { setPage(1); setTerm(value); },
                        placeholder: t("searchConversations"),
                    }}
                />
                {loadingList ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : conversations.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                        {term ? t("noMatchingConversations") : t("noConversationsYet")}
                    </p>
                ) : (
                    <ul className="-mx-2">
                        {conversations.map((conversation) => {
                            const unread = conversation.unreadCount > 0;
                            const other = conversation.participants[0];
                            const names = conversation.participants.map((p) => p.username).join(", ");
                            const mine = conversation.lastMessage?.authorId === me;
                            return (
                                <li key={conversation.id}>
                                    <button
                                        type="button"
                                        onClick={() => openConversation(conversation.id)}
                                        className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-muted"
                                    >
                                        <MemberAvatar name={other?.username ?? names} src={other?.avatar} />
                                        <div className="min-w-0 flex-1">
                                            <span
                                                className={cn(
                                                    "block truncate text-foreground",
                                                    unread ? "font-semibold" : "font-medium",
                                                )}
                                            >
                                                {names}
                                            </span>
                                            {conversation.lastMessage && (
                                                <p
                                                    className={cn(
                                                        "truncate text-sm",
                                                        unread ? "text-foreground" : "text-muted-foreground",
                                                    )}
                                                >
                                                    {/* Whose line it was, so a reader can tell
                                                        "waiting on them" from "waiting on me". */}
                                                    {mine && <span className="text-muted-foreground">{t("youSaid")} </span>}
                                                    {conversation.lastMessage.body}
                                                </p>
                                            )}
                                        </div>
                                        {/* When and how many, stacked at the right edge. They
                                            were two separate children of the row - the time
                                            inside the name's line and the count centred beside
                                            the whole row - so they landed near each other at
                                            different heights and read as two things fighting
                                            for the same corner. */}
                                        <div className="flex flex-shrink-0 flex-col items-end gap-1 self-start">
                                            {conversation.lastMessageAt && (
                                                <span className={cn("text-xs", unread ? "text-primary" : "text-muted-foreground")}>
                                                    {relativeTime(conversation.lastMessageAt)}
                                                </span>
                                            )}
                                            {unread ? (
                                                <span
                                                    className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground"
                                                    aria-label={t("unreadMessages", { count: conversation.unreadCount })}
                                                >
                                                    {conversation.unreadCount}
                                                </span>
                                            ) : (
                                                // Holds the badge's line so a read row is the
                                                // same height as an unread one and the list
                                                // does not step as messages are opened.
                                                <span className="h-5" aria-hidden="true" />
                                            )}
                                        </div>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {!loadingList && (
                    <Pagination page={paging.page} pages={paging.pages} total={paging.total} onPageChange={setPage} />
                )}
            </CardContent>
        </Card>
    );
}
