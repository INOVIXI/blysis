"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Label } from "@/core/components/ui/label";
import { PasswordInput } from "@/core/components/ui/password-input";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { errorMessage } from "@/core/lib/write-result";

interface PasswordCardProps {
    userId: string;
    username: string;
}

/**
 * An operator giving a member a new password, for the member who cannot
 * reset theirs by mail. The member is signed out everywhere, so it asks
 * first; the password itself is told to them by whoever set it.
 */
export function PasswordCard({ userId, username }: PasswordCardProps) {
    const t = useTranslations("admin");
    const authT = useTranslations("auth");
    const { confirm } = useConfirm();
    const fieldId = useId();
    const [password, setPassword] = useState("");
    const [saving, setSaving] = useState(false);

    const save = async () => {
        if (password === "") return;
        const ok = await confirm({
            title: t("users_passwordConfirmTitle", { username }),
            message: t("users_passwordConfirmMessage", { username }),
            confirmText: t("users_passwordSet"),
            cancelText: t("users_cancel"),
            variant: "danger",
        });
        if (!ok) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/v1/users/${userId}/password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { code?: string } | null;
                // The policy and breach refusals are the sign-in screens'
                // own, worded once in `auth`; the rest are this screen's.
                const code = body?.code;
                const asked = code === "weak_password" || code === "password_breached" ? authT : t;
                toast.error(errorMessage(body, t("common_writeFailed"), asked));
                return;
            }
            setPassword("");
            toast.success(t("users_passwordSaved", { username }));
        } catch {
            toast.error(t("common_writeFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("users_password")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                <p className="text-xs text-muted-foreground">{t("users_passwordHint", { username })}</p>
                <div className="space-y-1">
                    <Label htmlFor={fieldId}>{t("users_passwordNew")}</Label>
                    <PasswordInput
                        id={fieldId}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        showLabel={authT("showPassword")}
                        hideLabel={authT("hidePassword")}
                    />
                </div>
                <Button onClick={save} disabled={saving || password === ""} className="w-full">
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t("users_passwordSet")}
                </Button>
            </CardContent>
        </Card>
    );
}
