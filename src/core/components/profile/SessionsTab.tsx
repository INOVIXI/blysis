"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { ListControls } from "@/core/components/ui/list-controls";
import { Pagination, usePagedRows } from "@/core/components/ui/pagination";
import { Loader2, Smartphone, Monitor, Trash2, Globe } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { useLocalDate } from "@/core/hooks/useLocalDate";

interface UserSession {
    id: string;
    deviceInfo: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    lastActiveAt: string;
    createdAt: string;
    expiresAt: string;
}

/**
 * The devices this account is signed in on.
 *
 * The endpoint answers up to fifty - a row is written per sign-in, not per
 * device - and every one of them was drawn, so the screen ran off the bottom
 * with thirty near-identical rows and no way to find the one an unfamiliar
 * address was on. The set is small and already in the browser, so the term
 * and the pages are worked out here rather than asked for again.
 */
export function SessionsTab() {
    const t = useTranslations("profile");
    // Still needed for the sign-out redirect below, which builds a path.
    const __locale = useLocale();
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate({ dateStyle: "medium", timeStyle: "short" });
    const [sessions, setSessions] = useState<UserSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [revoking, setRevoking] = useState<Set<string>>(new Set());
    const [term, setTerm] = useState("");
    const { confirm } = useConfirm();

    function detectDevice(ua: string | null): { icon: typeof Monitor; label: string } {
        if (!ua) return { icon: Globe, label: t("unknownDevice") };
        if (/iPhone|iPad|Android/i.test(ua)) return { icon: Smartphone, label: t("mobile") };
        return { icon: Monitor, label: t("desktop") };
    }

    const fetchSessions = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/v1/sessions");
            const data = await res.json();
            setSessions(data.sessions || []);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchSessions(); }, []);

    const revoke = async (s: UserSession) => {
        const ok = await confirm({
            title: t("revokeSession"),
            message: t("revokeSessionMessage"),
            variant: "danger",
        });
        if (!ok) return;
        setRevoking((set) => new Set(set).add(s.id));
        try {
            const res = await fetch(`/api/v1/sessions/${s.id}`, { method: "DELETE" });
            if (res.ok) {
                toast.success(t("sessionRevoked"));
                fetchSessions();
            } else {
                toast.error(t("failed"));
            }
        } finally {
            setRevoking((set) => {
                const next = new Set(set);
                next.delete(s.id);
                return next;
            });
        }
    };

    const revokeAll = async () => {
        const ok = await confirm({
            title: t("signOutEverywhere"),
            message: t("signOutEverywhereMessage"),
            variant: "danger",
        });
        if (!ok) return;
        const res = await fetch("/api/v1/sessions/revoke-all", { method: "POST" });
        if (res.ok) {
            const data = await res.json();
            toast.success(t("revokedSessions", { count: data.count }));
            // After revoking all sessions this tab holds a cookie that no longer
            // resolves. A full load is the point: it discards every cached
            // server component and client store built while the user was
            // authenticated, rather than carrying them into a logged-out session.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = `/${__locale}/auth/login`;
        }
    };

    // The device name and the address are what a reader recognises a session
    // by; the user agent is what they paste in when they do not.
    const matching = useMemo(() => {
        const needle = term.trim().toLowerCase();
        if (!needle) return sessions;
        return sessions.filter((s) =>
            [s.deviceInfo, s.ipAddress, s.userAgent]
                .some((field) => (field ?? "").toLowerCase().includes(needle)),
        );
    }, [sessions, term]);

    const paged = usePagedRows(matching, 10);

    if (loading) {
        return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                        <Monitor className="w-5 h-5" />
                        {t("activeSessions")}
                    </span>
                    {sessions.length > 1 && (
                        <Button variant="outline" size="sm" onClick={revokeAll}>
                            {t("signOutEverywhere")}
                        </Button>
                    )}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {sessions.length > 0 && (
                    <ListControls
                        search={{ value: term, onChange: setTerm, placeholder: t("searchDevices") }}
                    />
                )}
                {sessions.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                        {t("sessionTrackingStarts")}
                    </p>
                ) : matching.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                        {t("noMatchingDevices")}
                    </p>
                ) : (
                    <div className="space-y-2">
                        {paged.rows.map((s) => {
                            const device = detectDevice(s.userAgent);
                            const Icon = device.icon;
                            return (
                                <div key={s.id} className="flex items-center gap-3 p-3 border border-border rounded-lg">
                                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                        <Icon className="w-5 h-5 text-muted-foreground" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm text-foreground">
                                            {s.deviceInfo || device.label}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            {s.ipAddress || t("unknownIp")} · {t("lastActive", { date: formatDate(s.lastActiveAt) })}
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive"
                                        onClick={() => revoke(s)}
                                        disabled={revoking.has(s.id)}
                                    >
                                        {revoking.has(s.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                )}
                {matching.length > 0 && (
                    <Pagination
                        page={paged.page}
                        pages={paged.pages}
                        total={paged.total}
                        onPageChange={paged.setPage}
                    />
                )}
            </CardContent>
        </Card>
    );
}
