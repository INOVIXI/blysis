"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, CheckboxField } from "@/core/sdk/ui";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/core/sdk/admin";
import { errorMessage } from "@/core/sdk";

interface TurnstileConfig {
    siteKey: string;
    secretKey: string;
    /** The forms the widget belongs on, by the id each one declared. */
    points: string[];
}

/**
 * The old two switches as points.
 *
 * An install that has Turnstile on its login form stored `enableOnLogin`, and
 * the listener still reads it. The screen shows that state as what it is - the
 * login point, ticked - so the first save writes it the new way and nothing
 * has to be migrated.
 */
function pointsFrom(stored: Record<string, unknown>): string[] {
    const chosen = new Set(Array.isArray(stored.points) ? (stored.points as string[]) : []);
    if (stored.enableOnLogin === true) chosen.add("login");
    if (stored.enableOnRegister === true) chosen.add("register");
    return [...chosen];
}

export default function CloudflareTurnstileAdminPage() {
    const t = useTranslations("cloudflareTurnstile");
    // The root catalogue: a point's name lives in the namespace of whichever
    // module declared it, core's own included.
    const anyT = useTranslations();
    // What can be switched on comes down with the settings: the list depends
    // on which modules are enabled, and that is a question for the server.
    const [points, setPoints] = useState<{ id: string; labelKey: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [secretStored, setSecretStored] = useState(false);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<TurnstileConfig>({
        siteKey: "",
        secretKey: "",
        points: [],
    });

    // A point whose catalogue has no word for it falls back to its id rather
    // than rendering a key at the operator.
    const nameOf = (point: { id: string; labelKey: string }) =>
        (anyT.has(point.labelKey) ? anyT(point.labelKey) : point.id);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/security/turnstile/settings")
            .then((r) => r.json())
            .then((d) => {
                if (cancelled) return;
                // The secret key is never in this response. It comes back as
                // "one is stored" or nothing, and the field stays empty so
                // toggling a switch below cannot wipe the key.
                setConfig({
                    siteKey: d.siteKey || "",
                    secretKey: "",
                    points: pointsFrom(d as Record<string, unknown>),
                });
                setSecretStored((d.secretsConfigured ?? []).length > 0);
                setPoints(Array.isArray(d.offered) ? d.offered : []);
            })
            .catch(() => toast.error(t("saveError")))
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [t]);

    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/v1/security/turnstile/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(errorMessage(data, t("saveError"), t));
                return;
            }
            toast.success(t("saved"));
        } catch {
            toast.error(t("saveError"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <>
            {/* The save is a header action, the same control in the same
                place as every other settings screen, rather than a full-width
                button pinned to the bottom of the card. */}
            <AdminPageHeader
                title={t("title")}
                description={t("subtitle")}
                actions={
                    <Button onClick={save} disabled={saving}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {t("save")}
                    </Button>
                }
            />

            {/* Two cards across the panel rather than one narrow column down
                its left edge. The screen has two subjects - the pair of keys
                Cloudflare issues, and the pages that ask for a challenge -
                and they are what the cards are. */}
            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>{t("keysTitle")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <Label>{t("siteKey")}</Label>
                            <Input
                                aria-label={t("siteKey")}
                                value={config.siteKey}
                                onChange={(e) => setConfig({ ...config, siteKey: e.target.value })}
                                placeholder="0x..."
                            />
                        </div>
                        <div>
                            <Label>{t("secretKey")}</Label>
                            <Input
                                aria-label={t("secretKey")}
                                type="password"
                                value={config.secretKey}
                                onChange={(e) => setConfig({ ...config, secretKey: e.target.value })}
                                placeholder="0x..."
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                {secretStored ? t("secretKeyStored") : t("secretKeyNotSet")}
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Every form this site takes something written through, not
                    the two this screen used to name. The list is whatever is
                    installed: a module that declares a point appears here
                    without this file knowing it exists. */}
                <Card>
                    <CardHeader>
                        <CardTitle>{t("challengeTitle")}</CardTitle>
                        <p className="text-sm text-muted-foreground">{t("challengeSubtitle")}</p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {points.map((point) => (
                            <CheckboxField
                                key={point.id}
                                checked={config.points.includes(point.id)}
                                onChange={(e) => setConfig({
                                    ...config,
                                    points: e.target.checked
                                        ? [...config.points, point.id]
                                        : config.points.filter((one) => one !== point.id),
                                })}
                                label={<span className="font-medium">{nameOf(point)}</span>}
                            />
                        ))}
                    </CardContent>
                </Card>
            </div>
        </>
    );
}
