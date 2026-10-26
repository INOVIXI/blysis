"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { notificationText } from "../../../lib/render";
import { toast } from "sonner";
import { Check, CheckCheck, Loader2 } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Button, Card, CardContent, Pagination, usePagedRows } from "@/core/sdk/ui";
import { ArrangedClientPage } from "@/core/sdk/layout";
import { useRelativeTime } from "@/core/sdk/ui";

interface NotificationItem {
    id: string;
    title: string;
    message: string;
    titleKey?: string | null;
    messageKey?: string | null;
    params?: Record<string, string | number> | null;
    type: string;
    href: string | null;
    isRead: boolean;
    createdAt: string;
}

export default function NotificationsPage() {
    const { data: session, status } = useSession();
    const t = useTranslations("inAppNotifications");
    const relativeTime = useRelativeTime();
    const [items, setItems] = useState<NotificationItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<"all" | "unread">("all");

    const load = useCallback(async () => {
        if (!session?.user) return;
        setLoading(true);
        try {
            const res = await fetch("/api/v1/notifications");
            if (!res.ok) {
                setItems([]);
                return;
            }
            const data = await res.json();
            setItems(Array.isArray(data.notifications) ? data.notifications : []);
        } finally {
            setLoading(false);
        }
    }, [session]);

    useEffect(() => {
        if (status === "loading") return;
        if (!session?.user) {
            setLoading(false);
            return;
        }
        load();
    }, [load, session, status]);

    const markRead = async (id: string) => {
        const res = await fetch("/api/v1/notifications", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
        });
        if (res.ok) {
            setItems(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
        } else {
            toast.error(t("markFailed"));
        }
    };

    const markAllRead = async () => {
        const res = await fetch("/api/v1/notifications", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ markAllRead: true }),
        });
        if (res.ok) {
            setItems(prev => prev.map(n => ({ ...n, isRead: true })));
            toast.success(t("markAllRead"));
        } else {
            toast.error(t("markFailed"));
        }
    };

    const filtered = filter === "unread" ? items.filter(n => !n.isRead) : items;

    const paged = usePagedRows(filtered, 15);
    const unreadCount = items.filter(n => !n.isRead).length;

    const actions = unreadCount > 0 ? (
        <Button variant="outline" onClick={markAllRead}>
            <CheckCheck className="w-4 h-4" /> {t("markAllRead")}
        </Button>
    ) : null;

    return (
        <ArrangedClientPage
            page="in-app-notifications.inbox"
            frame={{ title: t("title"), description: unreadCount > 0 ? t("unreadCount", { count: unreadCount }) : undefined, actions }}
            blocks={{
                inbox: () => (
                    <>
                        {session?.user && (
                            <div className="flex gap-2 mb-4">
                                <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>
                                    {t("all")}
                                </Button>
                                <Button variant={filter === "unread" ? "default" : "outline"} size="sm" onClick={() => setFilter("unread")}>
                                    {t("unread")}
                                </Button>
                            </div>
                        )}

                        {status === "loading" || loading ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : !session?.user ? (
                            <Card>
                                <CardContent className="py-12 text-center text-muted-foreground">
                                    {t("loginRequired")}
                                </CardContent>
                            </Card>
                        ) : filtered.length === 0 ? (
                            <Card>
                                <CardContent className="py-12 text-center text-muted-foreground">
                                    {t("noNotifications")}
                                </CardContent>
                            </Card>
                        ) : (
                            <Card>
                                <CardContent className="p-0 divide-y divide-border">
                                    {paged.rows.map(n => {
                                        const said = notificationText(n, t);
                                        const body = (
                                            <div className="flex items-start gap-3 p-4">
                                                {!n.isRead && (
                                                    <span className="mt-2 inline-block w-2 h-2 rounded-full bg-primary flex-shrink-0" aria-hidden="true" />
                                                )}
                                                <div className={`flex-1 min-w-0 ${n.isRead ? "pl-4" : ""}`}>
                                                    <p className="font-medium text-foreground">{said.title}</p>
                                                    <p className="text-sm text-muted-foreground mt-0.5">{said.message}</p>
                                                    <p className="text-xs text-muted-foreground mt-1">{relativeTime(n.createdAt)}</p>
                                                </div>
                                                {!n.isRead && (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); markRead(n.id); }}
                                                        className="text-xs text-primary hover:underline inline-flex items-center gap-1 flex-shrink-0"
                                                        aria-label={t("markRead")}
                                                    >
                                                        <Check className="w-3 h-3" /> {t("markRead")}
                                                    </button>
                                                )}
                                            </div>
                                        );
                                        return n.href ? (
                                            <Link key={n.id} href={n.href} onClick={() => { if (!n.isRead) markRead(n.id); }} className="block hover:bg-muted/50 transition-colors">
                                                {body}
                                            </Link>
                                        ) : (
                                            <div key={n.id} className="hover:bg-muted/30">{body}</div>
                                        );
                                    })}
                                    {paged.pages > 1 && (
                                        <Pagination className="p-4" page={paged.page} pages={paged.pages} total={paged.total} onPageChange={paged.setPage} />
                                    )}
                                </CardContent>
                            </Card>
                        )}
                    </>
                ),
            }}
        />
    );
}
