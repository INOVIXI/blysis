"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface NotifType {
    eventType: string;
    label: string;
    description?: string;
    channels?: string[];
    module: string;
}

interface Pref {
    eventType: string;
    channel: string;
    enabled: boolean;
}

const DEFAULT_CHANNELS = ["email", "inapp"];

/**
 * `blog.article.created` becomes `notificationType_blog_article_created`, so a
 * module translates its rows without core knowing any of their names.
 *
 * The event's own name used to be printed under the label as well, in a
 * monospace line. It is the hook a module fires, which is a name for whoever
 * wrote the module and nothing at all to the person deciding whether they
 * want an email: the row said "Credits added to your balance" and then
 * "credits.credit.added" underneath it. What a row does is the label and the
 * description; the machine name has no reader here.
 */
export function notificationTypeKey(eventType: string): string {
    return `notificationType_${eventType.replace(/[.\-]/g, "_")}`;
}

export function NotificationPrefsTab() {
    const t = useTranslations("profile");
    const [types, setTypes] = useState<NotifType[]>([]);
    const [prefs, setPrefs] = useState<Pref[]>([]);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState<Set<string>>(new Set());

    useEffect(() => {
        fetch("/api/v1/notification-preferences")
            .then((r) => r.json())
            .then((d) => {
                setTypes(d.types || []);
                setPrefs(d.prefs || []);
            })
            .finally(() => setLoading(false));
    }, []);

    // A pref is "enabled" by default unless an explicit row says otherwise
    const labelFor = (type: { eventType: string; label: string }): string => {
        const key = notificationTypeKey(type.eventType);
        return t.has(key) ? t(key) : type.label;
    };

    // "inapp" is a column name in a manifest. The heading already said the
    // word in the reader's language and the switch's accessible name did not.
    const channelLabel = (channel: string): string =>
        t.has(`channel_${channel}`) ? t(`channel_${channel}`) : channel;

    const isEnabled = (eventType: string, channel: string): boolean => {
        const p = prefs.find((x) => x.eventType === eventType && x.channel === channel);
        return p ? p.enabled : true;
    };

    const toggle = async (eventType: string, channel: string) => {
        const key = `${eventType}:${channel}`;
        if (updating.has(key)) return;
        setUpdating((s) => new Set(s).add(key));

        const current = isEnabled(eventType, channel);
        const next = !current;

        // Optimistic update
        setPrefs((prev) => {
            const without = prev.filter((p) => !(p.eventType === eventType && p.channel === channel));
            return [...without, { eventType, channel, enabled: next }];
        });

        try {
            const res = await fetch("/api/v1/notification-preferences", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ eventType, channel, enabled: next }),
            });
            if (!res.ok) {
                toast.error(t("failedToUpdate"));
                // Revert
                setPrefs((prev) => {
                    const without = prev.filter((p) => !(p.eventType === eventType && p.channel === channel));
                    return [...without, { eventType, channel, enabled: current }];
                });
            }
        } finally {
            setUpdating((s) => {
                const next = new Set(s);
                next.delete(key);
                return next;
            });
        }
    };

    if (loading) {
        return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("notificationPreferences")}</CardTitle>
            </CardHeader>
            <CardContent>
                {types.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">{t("noNotificationTypes")}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left py-2 pr-4">{t("event")}</th>
                                    {DEFAULT_CHANNELS.map((c) => (
                                        <th key={c} className="text-center py-2 px-3 text-xs uppercase font-medium text-muted-foreground">
                                            {channelLabel(c)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {types.map((type) => {
                                    const channels = type.channels || DEFAULT_CHANNELS;
                                    return (
                                        <tr key={type.eventType} className="border-b border-border last:border-0">
                                            <td className="py-3 pr-4">
                                                {/* The manifest's label is English, written by whoever
                                                    packaged the module. The reader gets their own
                                                    language when the module ships the key, the same way
                                                    the channel headings above already work. */}
                                                <div className="font-medium text-foreground">{labelFor(type)}</div>
                                                {type.description && (
                                                    <div className="text-xs text-muted-foreground">{type.description}</div>
                                                )}
                                            </td>
                                            {DEFAULT_CHANNELS.map((channel) => {
                                                const supported = channels.includes(channel);
                                                if (!supported) return <td key={channel} className="text-center py-3 px-3 text-muted-foreground">-</td>;
                                                const enabled = isEnabled(type.eventType, channel);
                                                return (
                                                    <td key={channel} className="text-center py-3 px-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => toggle(type.eventType, channel)}
                                                            role="switch"
                                                            aria-checked={enabled}
                                                            aria-label={t("toggleChannelAria", { event: labelFor(type), channel: channelLabel(channel) })}
                                                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                                                enabled ? "bg-primary" : "bg-muted"
                                                            }`}
                                                        >
                                                            <span
                                                                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                                                                    enabled ? "translate-x-5" : "translate-x-1"
                                                                }`}
                                                            />
                                                        </button>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
