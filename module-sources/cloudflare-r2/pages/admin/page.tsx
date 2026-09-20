"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, CheckboxField, Badge } from "@/core/sdk/ui";
import { Loader2, Save, Check } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/core/sdk/admin";
import { errorMessage } from "@/core/sdk";

interface R2Config {
    accountId: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    publicUrl: string;
    /** Whether the database backups are copied here, and where in the bucket. */
    keepBackups: boolean;
    backupPrefix: string;
}

export default function CloudflareR2AdminPage() {
    const t = useTranslations("cloudflareR2");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isActive, setIsActive] = useState(false);
    const [secretStored, setSecretStored] = useState(false);
    const [setActive, setSetActive] = useState(false);
    const [config, setConfig] = useState<R2Config>({
        accountId: "",
        bucket: "",
        accessKey: "",
        secretKey: "",
        publicUrl: "",
        keepBackups: false,
        backupPrefix: "",
    });

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/storage/cloudflare-r2/settings")
            .then((r) => r.json())
            .then((d) => {
                if (cancelled) return;
                // The secret key is never in this response. It comes back as
                // "one is stored" or nothing, and the field stays empty so a
                // save that does not touch it keeps what is there.
                if (d.config) setConfig({
                    ...config,
                    ...d.config,
                    secretKey: "",
                    keepBackups: d.config.keepBackups === true,
                    backupPrefix: typeof d.config.backupPrefix === "string" ? d.config.backupPrefix : "",
                });
                setSecretStored((d.secretsConfigured ?? []).length > 0);
                setIsActive(!!d.isActive);
                setSetActive(!!d.isActive);
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
            const res = await fetch("/api/v1/storage/cloudflare-r2/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...config, setActive }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(errorMessage(data, t("saveError"), t));
                return;
            }
            toast.success(t("saved"));
            if (setActive) setIsActive(true);
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
            {/* A title is words: the icon this one drew belongs to the
                sidebar entry, and no other admin screen puts one here. The
                save is a header action too, rather than a full-width button
                at the bottom of the card - a third shape for the same
                control, on a screen one click from two that use the other
                two. */}
            <AdminPageHeader
                title={t("title")}
                description={t("subtitle")}
                actions={
                    <>
                        {isActive && (
                            <Badge tone="success"><Check className="w-3.5 h-3.5" />{t("currentlyActive")}</Badge>
                        )}
                        <Button onClick={save} disabled={saving}>
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {saving ? t("saving") : t("save")}
                        </Button>
                    </>
                }
            />

            {/* What Cloudflare issues and what the bucket is called are two
                different jobs, done on two different Cloudflare screens, so
                they are two cards side by side instead of one column of five
                fields against the left edge of the panel. */}
            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>{t("credentialsTitle")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <Label>{t("accountId")}</Label>
                            <Input
                                aria-label={t("accountId")}
                                value={config.accountId}
                                onChange={(e) => setConfig({ ...config, accountId: e.target.value })}
                                placeholder="abc123def456..."
                            />
                        </div>
                        <div>
                            <Label>{t("accessKey")}</Label>
                            <Input
                                aria-label={t("accessKey")}
                                value={config.accessKey}
                                onChange={(e) => setConfig({ ...config, accessKey: e.target.value })}
                                placeholder="..."
                            />
                        </div>
                        <div>
                            <Label>{t("secretKey")}</Label>
                            <Input
                                aria-label={t("secretKey")}
                                type="password"
                                value={config.secretKey}
                                onChange={(e) => setConfig({ ...config, secretKey: e.target.value })}
                                placeholder="..."
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                {secretStored ? t("secretKeyStored") : t("secretKeyNotSet")}
                            </p>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>{t("bucketTitle")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <Label>{t("bucket")}</Label>
                            <Input
                                aria-label={t("bucket")}
                                value={config.bucket}
                                onChange={(e) => setConfig({ ...config, bucket: e.target.value })}
                                placeholder="my-bucket"
                            />
                        </div>
                        <div>
                            <Label>{t("publicUrl")}</Label>
                            <Input
                                aria-label={t("publicUrl")}
                                value={config.publicUrl}
                                onChange={(e) => setConfig({ ...config, publicUrl: e.target.value })}
                                placeholder="https://pub-xxx.r2.dev"
                            />
                            <p className="text-xs text-muted-foreground mt-1">{t("publicUrlHint")}</p>
                        </div>
                        <CheckboxField
                            checked={setActive}
                            onChange={(e) => setSetActive(e.target.checked)}
                            label={t("active")}
                        />
                    </CardContent>
                </Card>

                {/* Keeping the backups here is a separate job from serving the
                    site's uploads, and an operator may want one without the
                    other: a bucket holding database dumps does not have to be
                    the bucket a visitor's avatar is served from. */}
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>{t("backupsTitle")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <CheckboxField
                            checked={config.keepBackups}
                            onChange={(e) => setConfig({ ...config, keepBackups: e.target.checked })}
                            label={t("keepBackups")}
                        />
                        <p className="text-xs text-muted-foreground">{t("keepBackupsHint")}</p>
                        <div>
                            <Label>{t("backupPrefix")}</Label>
                            <Input
                                aria-label={t("backupPrefix")}
                                className="max-w-sm"
                                value={config.backupPrefix}
                                disabled={!config.keepBackups}
                                onChange={(e) => setConfig({ ...config, backupPrefix: e.target.value })}
                                placeholder="backups"
                            />
                            <p className="text-xs text-muted-foreground mt-1">{t("backupPrefixHint")}</p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </>
    );
}
