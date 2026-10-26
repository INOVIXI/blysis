"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { Check, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { CheckboxField } from "@/core/components/ui/checkbox";
import { RadioField } from "@/core/components/ui/radio";
import { Badge } from "@/core/components/ui/badge";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { errorMessage } from "@/core/lib/write-result";

type HealthStatus = "ok" | "degraded" | "down";

interface AlertingConfig {
    enabled: boolean;
    channel: string;
    webhookUrl: string;
    alertOn: HealthStatus[];
}

/**
 * Delivery channels are supplied by the API, which builds the list from the
 * built-in generic channel plus whatever enabled modules declare. The page
 * names no vendor of its own.
 */
interface WebhookChannel {
    id: string;
    label: string;
    hosts?: string[];
    urlPlaceholder?: string;
}

const STATUSES: HealthStatus[] = ["degraded", "down"];

export default function AlertingSettingsPage() {
    const t = useTranslations("admin");

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    const [enabled, setEnabled] = useState(false);
    const [channels, setChannels] = useState<WebhookChannel[]>([]);
    const [channelId, setChannelId] = useState("generic");
    const [webhookUrl, setWebhookUrl] = useState("");
    const [alertOn, setAlertOn] = useState<HealthStatus[]>(["degraded", "down"]);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch("/api/v1/admin/alerting");
                if (res.ok) {
                    const data = await res.json();
                    const config: AlertingConfig = data.config;
                    setChannels(data.channels ?? []);
                    setEnabled(config.enabled);
                    setChannelId(config.channel);
                    setWebhookUrl(config.webhookUrl);
                    setAlertOn(config.alertOn);
                }
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const activeChannel = channels.find((c) => c.id === channelId);

    const toggleAlertOn = (status: HealthStatus) => {
        setAlertOn((prev) =>
            prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
        );
    };

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (alertOn.length === 0) {
            toast.error(t("alerting_selectAtLeastOne"));
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/v1/admin/alerting", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled, channel: channelId, webhookUrl, alertOn }),
            });
            if (res.ok) {
                toast.success(t("alerting_saved"));
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(errorMessage(data, t("alerting_saveFailed"), t));
            }
        } finally {
            setSaving(false);
        }
    };

    const sendTest = async () => {
        if (!webhookUrl) {
            toast.error(t("alerting_saveFirst"));
            return;
        }
        setTesting(true);
        try {
            const res = await fetch("/api/v1/admin/alerting/test", { method: "POST" });
            if (res.ok) {
                toast.success(t("alerting_testSent"));
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(errorMessage(data, t("alerting_testFailed"), t));
            }
        } finally {
            setTesting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <form onSubmit={save}>
            <AdminPageHeader
                title={t("alerting_title")}
                description={t("alerting_subtitle")}
                actions={<>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={testing || !webhookUrl}
                        onClick={sendTest}
                    >
                        {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        {testing ? t("alerting_testing") : t("alerting_test")}
                    </Button>
                    <Button type="submit" disabled={saving}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        {saving ? t("alerting_saving") : t("alerting_save")}
                    </Button>
                </>}
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 items-start">
                {/* The switch is its own card and comes first, because
                    everything below it is inert while it is off. */}
                <Card className="lg:col-span-3">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                        <CheckboxField
                            id="enabled"
                            checked={enabled}
                            onChange={(e) => setEnabled(e.target.checked)}
                            label={<span className="font-medium">{t("alerting_enabled")}</span>}
                            description={t("alerting_subtitle")}
                        />
                        <Badge tone={enabled ? "success" : "neutral"}>
                            {enabled ? t("alerting_on") : t("alerting_off")}
                        </Badge>
                    </CardContent>
                </Card>

                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>{t("alerting_webhookTitle")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <fieldset disabled={!enabled} className="space-y-5 disabled:opacity-60">
                            <div>
                                <Label>{t("alerting_channel")}</Label>
                                <div className="flex flex-wrap gap-4 mt-2">
                                    {channels.map((c) => (
                                        <RadioField
                                            key={c.id}
                                            name="channel"
                                            value={c.id}
                                            checked={channelId === c.id}
                                            onChange={() => setChannelId(c.id)}
                                            label={c.label}
                                        />
                                    ))}
                                </div>
                                {channels.length === 1 && (
                                    <p className="text-xs text-muted-foreground mt-2">
                                        {t("alerting_channelHint")}
                                    </p>
                                )}
                            </div>

                            <div>
                                <Label htmlFor="alerting-webhook-url">{t("alerting_webhookUrl")}</Label>
                                <Input
                                    id="alerting-webhook-url"
                                    type="url"
                                    value={webhookUrl}
                                    onChange={(e) => setWebhookUrl(e.target.value)}
                                    placeholder={activeChannel?.urlPlaceholder ?? "https://"}
                                />
                                <p className="text-xs text-muted-foreground mt-1.5">
                                    {activeChannel?.hosts?.length
                                        ? `${t("alerting_hostHint")} ${activeChannel.hosts.join(", ")}`
                                        : t("alerting_publicHint")}
                                </p>
                            </div>
                        </fieldset>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>{t("alerting_alertOn")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <fieldset disabled={!enabled} className="space-y-3 disabled:opacity-60">
                            {STATUSES.map((status) => (
                                <CheckboxField
                                    key={status}
                                    checked={alertOn.includes(status)}
                                    onChange={() => toggleAlertOn(status)}
                                    // The two states were rendered as the raw
                                    // English words the API uses, with
                                    // `capitalize` on top, so a Turkish panel
                                    // offered "Degraded" and "Down".
                                    label={t(`health_${status}`)}
                                    description={t(`alerting_${status}Hint`)}
                                />
                            ))}
                            <p className="text-xs text-muted-foreground pt-1">
                                {t("alerting_alertOnHint")}
                            </p>
                        </fieldset>
                    </CardContent>
                </Card>
            </div>
        </form>
    );
}
