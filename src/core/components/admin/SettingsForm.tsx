"use client";

import { useState } from "react";
import { Card, CardContent } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { UrlOrFile } from "@/core/components/ui/url-or-file";
import { IconPicker } from "@/core/components/ui/icon-picker";
import { Loader2, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { NativeSelect } from "@/core/components/ui/native-select";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { useSettingsLoad } from "@/core/hooks/useSettingsLoad";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { Textarea } from "@/core/components/ui/textarea";
import { useConfirm } from "@/core/components/ui/confirm-dialog";

export interface SettingsField {
    key: string;
    label: string;
    /** "icon" renders the Lucide icon picker and stores the icon's kebab-case name. */
    type?: "text" | "password" | "number" | "url" | "email" | "textarea" | "image" | "select" | "date" | "icon";
    placeholder?: string;
    description?: string;
    defaultValue?: string;
    accept?: string;
    options?: { value: string; label: string }[];
}

interface SettingsFormProps {
    title: string;
    subtitle: string;
    fields: SettingsField[];
    children?: React.ReactNode;
}

/** The header's submit button points at the form by id; they are the same form. */
const FORM_ID = "settings-form";

/**
 * A credential is never loaded back into this form.
 *
 * `GET /api/v1/settings` stopped returning the value of any key a module
 * declared as a credential, so a password field starts empty on every visit
 * and an empty one on save means "leave the stored value alone". That is what
 * lets an operator change the sandbox flag on a gateway screen without
 * retyping the merchant salt, and it is why clearing one needs its own button:
 * with blank meaning "unchanged", there would otherwise be no way to say
 * "remove it".
 */
function isSecretField(field: SettingsField): boolean {
    return field.type === "password";
}

export function SettingsForm({ title, subtitle, fields, children }: SettingsFormProps) {
    const t = useTranslations("admin");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [values, setValues] = useState<Record<string, string>>({});
    const [cleared, setCleared] = useState<Set<string>>(new Set());
    const { confirm } = useConfirm();

    // Shared by every screen built out of this form, so the hole was shared
    // too: a failed read rendered the defaults and the save button under them
    // wrote the defaults back.
    const { loading, failed, retry, secretsConfigured } = useSettingsLoad((s) => {
        const v: Record<string, string> = {};
        for (const field of fields) {
            v[field.key] = isSecretField(field)
                ? ""
                : (s[field.key] as string) || field.defaultValue || "";
        }
        setValues(v);
    });

    const stored = new Set(secretsConfigured);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        setSaved(false);

        try {
            // A blank credential is omitted rather than sent: the endpoint
            // only writes the keys it receives, so leaving one out is how the
            // stored value survives a save of the fields beside it. A cleared
            // one is sent as empty, which is the one way to remove it.
            const payload: Record<string, string> = {};
            for (const field of fields) {
                const value = values[field.key] ?? "";
                if (!isSecretField(field)) { payload[field.key] = value; continue; }
                if (cleared.has(field.key)) { payload[field.key] = ""; continue; }
                if (value !== "") payload[field.key] = value;
            }

            const res = await fetch("/api/v1/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                // One refusal has an answer the operator can act on, and it is
                // not "try again": the server has no key to encrypt a
                // credential with. Left generic, it reads as a broken form.
                const body = (await res.json().catch(() => ({}))) as { code?: string };
                setError(
                    body.code === "secret_key_missing"
                        ? t("settingsForm_secretKeyMissing")
                        : t("settingsForm_failedToSave"),
                );
                return;
            }
            setCleared(new Set());
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch {
            setError(t("settingsForm_somethingWrong"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
    }

    if (failed) {
        return (
            <>
                <AdminPageHeader title={title} description={subtitle} />
                <Card><CardContent><LoadFailed onRetry={retry} /></CardContent></Card>
            </>
        );
    }

    return (
        <>
            {/* The save lives in the header rather than under the card. On a
                settings screen the page *is* the form, so its save is a
                page-level action and belongs with the rest of them; left at
                the bottom it sat in a different place on every screen,
                depending only on how many fields that screen happened to
                have. `form` is what lets a submit button stand outside the
                form it submits. */}
            <AdminPageHeader
                title={title}
                description={subtitle}
                actions={
                    <Button type="submit" form={FORM_ID} disabled={saving}>
                        {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("settingsForm_saving")}</> :
                         saved ? <><Check className="w-4 h-4" /> {t("settingsForm_saved")}</> : t("settingsForm_saveSettings")}
                    </Button>
                }
            />

            {error && <div role="alert" className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>}

            <form id={FORM_ID} onSubmit={handleSave}>
                <Card>
                    <CardContent className="p-6 space-y-4">
                        {fields.map((field) => (
                            <div key={field.key}>
                                <Label>{field.label}</Label>
                                {field.type === "textarea" ? (
                                    <Textarea
                                        aria-label={field.label}
                                        value={values[field.key] || ""}
                                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                                        placeholder={field.placeholder}
                                        rows={3}
                                    />
                                ) : field.type === "image" ? (
                                    <UrlOrFile
                                        value={values[field.key] || ""}
                                        onChange={(v) => setValues({ ...values, [field.key]: v })}
                                        accept={field.accept || "image/*"}
                                    />
                                ) : field.type === "icon" ? (
                                    <IconPicker
                                        value={values[field.key] || ""}
                                        onChange={(v) => setValues({ ...values, [field.key]: v })}
                                        placeholder={field.placeholder}
                                    />
                                ) : field.type === "select" ? (
                                    <NativeSelect
                                        value={values[field.key] || ""}
                                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                                        aria-label={field.label} className="w-full" inputSize="sm"
                                    >
                                        {field.placeholder && !values[field.key] && (
                                            <option value="">{field.placeholder}</option>
                                        )}
                                        {(field.options || []).map((opt) => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </NativeSelect>
                                ) : (
                                    <Input
                                        type={field.type || "text"}
                                        value={values[field.key] || ""}
                                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                                        placeholder={
                                            isSecretField(field) && stored.has(field.key)
                                                ? t("settingsForm_secretKept")
                                                : field.placeholder
                                        }
                                        aria-label={field.label}
                                    />
                                )}
                                {field.description && (
                                    <p className="text-xs text-muted-foreground mt-1">{field.description}</p>
                                )}
                                {isSecretField(field) && (
                                    <div className="flex items-center gap-2 mt-1">
                                        <p className="text-xs text-muted-foreground">
                                            {cleared.has(field.key)
                                                ? t("settingsForm_secretRemoved")
                                                : stored.has(field.key)
                                                    ? t("settingsForm_secretStored")
                                                    : t("settingsForm_secretNotSet")}
                                        </p>
                                        {stored.has(field.key) && !cleared.has(field.key) && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={async () => {
                                                    const ok = await confirm({
                                                        title: t("settingsForm_secretRemoveTitle"),
                                                        message: t("settingsForm_secretRemoveBody"),
                                                        variant: "danger",
                                                    });
                                                    if (!ok) return;
                                                    setValues({ ...values, [field.key]: "" });
                                                    setCleared(new Set(cleared).add(field.key));
                                                }}
                                            >
                                                {t("settingsForm_secretRemove")}
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </CardContent>
                </Card>

                {children}
            </form>
        </>
    );
}
