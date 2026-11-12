"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { CheckboxField } from "@/core/components/ui/checkbox";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { errorMessage } from "@/core/lib/write-result";
import { LocalizedTextInput } from "@/core/components/ui/localized-text-input";
import { isTranslatableText, type TranslatableText } from "@/core/lib/i18n/translatable-text";

interface MaintenanceConfig {
    enabled: boolean;
    message?: TranslatableText;
    allowedRoles?: string[];
}

/**
 * The checkbox list used to be these three names, hardcoded.
 *
 * Roles are the admin's to create and rename, so on a site with a "developer"
 * role the list offered a box for a role nobody has and no box for the one
 * they wanted; on a site that renamed "member" it offered two. The real roles
 * come from the API, and the free-text field below stays for a name that does
 * not exist yet - "admin" is always in the list even if the query fails, since
 * the gate falls back to it.
 */
const FALLBACK_ROLE_OPTIONS = ["admin"];

export default function MaintenanceSettingsPage() {
    const t = useTranslations("admin");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [message, setMessage] = useState<TranslatableText>("");
    const [allowedRoles, setAllowedRoles] = useState<string[]>(["admin"]);
    const [roleOptions, setRoleOptions] = useState<string[]>(FALLBACK_ROLE_OPTIONS);

    useEffect(() => {
        fetch("/api/v1/roles")
            .then((r) => (r.ok ? r.json() : null))
            .then((payload: { roles?: { name: string }[] } | null) => {
                const names = (payload?.roles ?? []).map((r) => r.name);
                if (names.length > 0) setRoleOptions(names);
            })
            .catch(() => { /* the fallback list and the free-text field still work */ });
    }, []);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/admin/maintenance")
            .then((r) => (r.ok ? r.json() : null))
            .then((payload: { data?: MaintenanceConfig } | null) => {
                if (cancelled) return;
                const cfg = payload?.data;
                if (cfg) {
                    setEnabled(Boolean(cfg.enabled));
                    setMessage(isTranslatableText(cfg.message) ? cfg.message : "");
                    setAllowedRoles(
                        cfg.allowedRoles && cfg.allowedRoles.length > 0
                            ? cfg.allowedRoles
                            : ["admin"]
                    );
                }
            })
            .catch(() => {
                toast.error(t("maintenance_loadFailed"));
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [t]);

    const toggleRole = (role: string) => {
        setAllowedRoles((prev) =>
            prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
        );
    };

    const onSave = async () => {
        if (!allowedRoles.includes("admin")) {
            toast.error(t("maintenance_adminRequired"));
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/v1/admin/maintenance", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ enabled, message, allowedRoles }),
            });
            if (!res.ok) {
                const data = (await res.json().catch(() => null)) as { error?: string } | null;
                toast.error(errorMessage(data, t("maintenance_saveFailed"), t));
                return;
            }
            toast.success(t("maintenance_saved"));
        } catch {
            toast.error(t("maintenance_saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* The page is one form, so its save is a page action: it sits in
                the header rather than in a right-aligned row after the last
                card, where its position depended on how many roles the
                allowlist happened to hold. */}
            <AdminPageHeader
                title={t("sidebar_maintenance")}
                description={t("maintenance_subtitle")}
                actions={
                    <Button onClick={onSave} disabled={saving}>
                        {saving ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" /> {t("common_saving")}
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" /> {t("moderationSettings_saveChanges")}
                            </>
                        )}
                    </Button>
                }
            />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t("common_status")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <CheckboxField
                        checked={enabled}
                        onChange={(e) => setEnabled(e.target.checked)}
                        label={<span className="font-medium">{t("maintenance_enable")}</span>}
                    />
                    <p className="text-xs text-muted-foreground">
                        When enabled, visitors whose role is not in the allowed list will see the
                        maintenance page. Authentication endpoints remain accessible so admins can
                        still sign in.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t("maintenance_message")}</CardTitle>
                </CardHeader>
                <CardContent>
                    <LocalizedTextInput
                        value={message}
                        onChange={setMessage}
                        multiline
                        rows={4}
                        maxLength={2000}
                        placeholder={t("maintenance_defaultMessage")} label={t("maintenance_defaultMessage")}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                        {t("maintenance_messageHelp")}
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t("maintenance_allowedRoles")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    <p className="text-xs text-muted-foreground mb-2">
                        {t("maintenance_allowedRolesHint")}
                    </p>
                    {/* Roles the site has, plus any name already saved that no
                        longer matches one - so an old entry stays visible and
                        removable rather than disappearing from the screen. */}
                    {[...new Set([...roleOptions, ...allowedRoles])].map((role) => (
                        <CheckboxField
                            key={role}
                            checked={allowedRoles.includes(role)}
                            onChange={() => toggleRole(role)}
                            disabled={role === "admin"}
                            label={<span className="capitalize">{role}</span>}
                            description={role === "admin" ? t("maintenance_adminAlwaysAllowed") : undefined}
                        />
                    ))}
                    <Input
                        type="text"
                        placeholder={t("maintenance_addRole")} aria-label={t("maintenance_addRole")}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                const target = e.target as HTMLInputElement;
                                const v = target.value.trim().toLowerCase();
                                if (v && !allowedRoles.includes(v)) {
                                    setAllowedRoles([...allowedRoles, v]);
                                }
                                target.value = "";
                            }
                        }}
                        className="mt-2"
                    />
                </CardContent>
            </Card>

        </div>
    );
}
