"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { useLocalDate } from "@/core/hooks/useLocalDate";
import { ProviderMark, providerLabel } from "@/core/components/auth/ProviderMark";

interface SignInMethod {
    provider: string;
    providerAccountId: string;
    displayName: string | null;
    connectedAt: string | null;
}

interface SignInMethodsCardProps {
    userId: string;
    username: string;
}

/**
 * The member's own sign-in methods, seen from the panel. An operator answering
 * "somebody else signs in with my Discord" removes it here; the member's rule
 * still holds, so the last way into an account is refused rather than taken.
 */
export function SignInMethodsCard({ userId, username }: SignInMethodsCardProps) {
    const t = useTranslations("admin");
    const formatDate = useLocalDate({ dateStyle: "medium" });
    const { confirm } = useConfirm();
    const [methods, setMethods] = useState<SignInMethod[] | null>(null);
    const [hasPassword, setHasPassword] = useState(false);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const res = await fetch(`/api/v1/users/${userId}/sign-in-methods`);
            if (!res.ok) throw new Error("load failed");
            const body = (await res.json()) as { methods: SignInMethod[]; hasPassword: boolean };
            setMethods(body.methods);
            setHasPassword(body.hasPassword);
        } catch {
            setFailed(true);
        }
    }, [userId]);

    useEffect(() => { load(); }, [load]);

    const remove = async (provider: string) => {
        const label = providerLabel(provider);
        const ok = await confirm({
            title: t("users_signInMethodRemoveTitle", { provider: label }),
            message: t("users_signInMethodRemoveMessage", { provider: label, username }),
            confirmText: t("users_signInMethodRemove"),
            cancelText: t("users_cancel"),
            variant: "danger",
        });
        if (!ok) return;
        setBusy(provider);
        try {
            const res = await fetch(`/api/v1/users/${userId}/sign-in-methods/${encodeURIComponent(provider)}`, {
                method: "DELETE",
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { code?: string };
                toast.error(body.code === "last_sign_in_method" ? t("users_signInMethodLast") : t("common_writeFailed"));
                return;
            }
            toast.success(t("users_signInMethodRemoved", { provider: label }));
            await load();
        } catch {
            toast.error(t("common_writeFailed"));
        } finally {
            setBusy(null);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("users_signInMethods")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                {failed ? (
                    <LoadFailed onRetry={load} />
                ) : methods === null ? (
                    <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                ) : (
                    <>
                        <p className="text-xs text-muted-foreground">
                            {hasPassword ? t("users_signInMethodsPassword") : t("users_signInMethodsNoPassword")}
                        </p>
                        {methods.length === 0 ? (
                            <p className="text-muted-foreground">{t("users_signInMethodsNone")}</p>
                        ) : (
                            <ul className="space-y-2">
                                {methods.map((method) => {
                                    const label = providerLabel(method.provider);
                                    return (
                                        <li key={method.provider} className="flex items-center gap-2">
                                            <ProviderMark provider={method.provider} className="w-4 h-4 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium truncate">{label}</div>
                                                <div className="text-xs text-muted-foreground truncate">
                                                    {[
                                                        method.displayName ?? method.providerAccountId,
                                                        method.connectedAt
                                                            ? t("users_signInMethodConnectedOn", { date: formatDate(method.connectedAt) })
                                                            : null,
                                                    ].filter(Boolean).join(" · ")}
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-destructive"
                                                onClick={() => remove(method.provider)}
                                                disabled={busy !== null}
                                                aria-label={t("users_signInMethodRemoveTitle", { provider: label })}
                                            >
                                                {busy === method.provider
                                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                                    : <Trash2 className="w-3 h-3" />}
                                            </Button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
