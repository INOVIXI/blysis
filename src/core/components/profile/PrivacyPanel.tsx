"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { PasswordInput } from "@/core/components/ui/password-input";
import { useModalDialog } from "@/core/hooks/useModalDialog";
import { authErrorMessage } from "@/core/lib/auth-error-message";

/** The word that has to be typed before the account goes. */
const CONFIRM_KEYWORD = "DELETE";

/**
 * What a member may take away with them, and how they leave.
 *
 * The two sit together because they are the same question asked twice: the
 * export is the copy somebody takes before the deletion they are about to
 * ask for, and separating them hid that.
 */
export function PrivacyPanel() {
    const t = useTranslations("profile");
    const authT = useTranslations("auth");
    const commonT = useTranslations("common");

    const passwordId = useId();
    const confirmId = useId();

    const [exporting, setExporting] = useState(false);
    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState("");
    const [confirmText, setConfirmText] = useState("");
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState("");

    // Escape, the Tab trap and returning focus to the button that opened it.
    // A delete already in flight is not interruptible, so Escape does nothing
    // until it finishes.
    const dialogRef = useModalDialog<HTMLDivElement>(open, () => {
        if (!deleting) setOpen(false);
    });

    const exportData = async () => {
        setExporting(true);
        try {
            const res = await fetch("/api/v1/auth/profile/export");
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                toast.error(authErrorMessage(authT, body, t("failedToExportData")));
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const disposition = res.headers.get("Content-Disposition") || "";
            a.download = disposition.match(/filename="([^"]+)"/)?.[1] || "blysis-data.zip";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast.success(t("dataExported"));
        } catch {
            toast.error(t("failedToExportData"));
        } finally {
            setExporting(false);
        }
    };

    const deleteAccount = async () => {
        setError("");
        setDeleting(true);
        try {
            const res = await fetch("/api/v1/auth/profile/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password, confirmText }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(authErrorMessage(authT, data, t("failedToUpdate")));
                return;
            }
            toast.success(t("accountDeleted"));
            await signOut({ callbackUrl: "/" });
        } catch {
            setError(t("somethingWentWrong"));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>{t("privacy")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="text-sm">
                            <div className="font-medium text-foreground">{t("downloadYourData")}</div>
                            <div className="text-muted-foreground">{t("downloadYourDataDesc")}</div>
                        </div>
                        <Button variant="outline" size="sm" onClick={exportData} disabled={exporting}>
                            {exporting
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("preparing")}</>
                                : <><Download className="w-4 h-4" /> {t("download")}</>}
                        </Button>
                    </div>
                    <div className="border-t border-border pt-4 flex items-start justify-between gap-4">
                        <div className="text-sm">
                            <div className="font-medium text-foreground">{t("deleteYourAccount")}</div>
                            <div className="text-muted-foreground">{t("deleteYourAccountDesc")}</div>
                        </div>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                                setPassword("");
                                setConfirmText("");
                                setError("");
                                setOpen(true);
                            }}
                        >
                            {t("deleteAccount")}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {open && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center" role="presentation">
                    <div
                        className="fixed inset-0 bg-black/50"
                        onClick={() => !deleting && setOpen(false)}
                        aria-hidden="true"
                    />
                    <div
                        ref={dialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="delete-title"
                        className="relative bg-card border border-[var(--blysis-color-border)] rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto"
                    >
                        <div className="flex items-start gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                                <AlertTriangle className="w-5 h-5 text-destructive" aria-hidden="true" />
                            </div>
                            <div>
                                <h2 id="delete-title" className="font-semibold text-foreground">
                                    {t("deleteAccountPermanently")}
                                </h2>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {t("deleteAccountWarning")}
                                </p>
                            </div>
                        </div>

                        {error && (
                            <div role="alert" className="mb-3 p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg">
                                {error}
                            </div>
                        )}

                        <div className="space-y-3">
                            <div>
                                <Label htmlFor={passwordId}>{t("currentPassword")}</Label>
                                <PasswordInput
                                    id={passwordId}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    autoComplete="current-password"
                                    showLabel={authT("showPassword")}
                                    hideLabel={authT("hidePassword")}
                                />
                            </div>
                            <div>
                                <Label htmlFor={confirmId}>
                                    {t("typeDeleteToConfirm", { keyword: CONFIRM_KEYWORD })}
                                </Label>
                                <Input
                                    id={confirmId}
                                    value={confirmText}
                                    onChange={(e) => setConfirmText(e.target.value)}
                                    placeholder={CONFIRM_KEYWORD}
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-6">
                            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={deleting}>
                                {commonT("cancel")}
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={deleteAccount}
                                disabled={deleting || password.length === 0 || confirmText !== CONFIRM_KEYWORD}
                            >
                                {deleting
                                    ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("deleting")}</>
                                    : t("deleteAccount")}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
