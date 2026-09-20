"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent, CardHeader, CardTitle, LoadFailed, useLocalDateTime } from "@/core/sdk/ui";
import { SettingsForm } from "@/core/sdk/admin";
import { errorMessage } from "@/core/sdk";
import { Loader2, LockOpen } from "lucide-react";
import { toast } from "sonner";

/**
 * Login throttling: the three numbers, and the people they shut out.
 *
 * This screen was one field. Two of the three numbers a lockout actually has
 * were environment-only - `account-lockout.ts` said so itself - so a site
 * wanting a ten minute window and an hour's lock had to be redeployed. And
 * `lockedUntil` was read in one file and written in the same one, which meant
 * a member who fat-fingered their password past the threshold waited it out
 * and the operator they wrote to had no way to help.
 */
interface LockedAccount {
    id: string;
    username: string;
    email: string;
    lockedUntil: string;
    attempts: number;
}

export default function SecuritySettingsPage() {
    const t = useTranslations("loginProtection");
    const formatDateTime = useLocalDateTime();
    const [locked, setLocked] = useState<LockedAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [unlocking, setUnlocking] = useState<string | null>(null);

    const read = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/v1/admin/security/lockouts");
            if (!res.ok) throw new Error("read failed");
            const data = await res.json();
            setLocked(Array.isArray(data.locked) ? data.locked : []);
            setFailed(false);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void read(); }, [read, attempt]);

    const unlock = async (account: LockedAccount) => {
        setUnlocking(account.id);
        try {
            const res = await fetch("/api/v1/admin/security/lockouts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: account.id }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                toast.error(errorMessage(data, t("adm_unlockFailed"), t));
                return;
            }
            toast.success(t("adm_unlocked", { username: account.username }));
            setLocked((rows) => rows.filter((row) => row.id !== account.id));
        } catch {
            toast.error(t("adm_unlockFailed"));
        } finally {
            setUnlocking(null);
        }
    };

    return (
        <SettingsForm
            title={t("adm_title")}
            subtitle={t("adm_subtitle")}
            fields={[
                { key: "max_login_attempts", label: t("adm_attemptsLabel"), type: "number", placeholder: "10", description: t("adm_attemptsDesc") },
                { key: "lockout_window_minutes", label: t("adm_windowLabel"), type: "number", placeholder: "15", description: t("adm_windowDesc") },
                { key: "lockout_duration_minutes", label: t("adm_lockLabel"), type: "number", placeholder: "15", description: t("adm_lockDesc") },
            ]}
        >
            {/* Below the numbers that produced them. An operator reading this
                screen is usually here because somebody wrote in, and the list
                is the answer to what they wrote in about. */}
            <Card className="mt-6">
                <CardHeader>
                    <CardTitle className="text-base">{t("adm_lockedTitle")}</CardTitle>
                    <p className="text-sm text-muted-foreground">{t("adm_lockedSubtitle")}</p>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-6">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
                        </div>
                    ) : failed ? (
                        <LoadFailed onRetry={() => setAttempt((n) => n + 1)} />
                    ) : locked.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("adm_lockedNone")}</p>
                    ) : (
                        <ul className="divide-y divide-border">
                            {locked.map((account) => (
                                <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                    <div className="min-w-0">
                                        <p className="font-medium truncate">{account.username}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {t("adm_lockedUntil", {
                                                until: formatDateTime(account.lockedUntil),
                                                attempts: account.attempts,
                                            })}
                                        </p>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={unlocking === account.id}
                                        onClick={() => void unlock(account)}
                                    >
                                        {unlocking === account.id
                                            ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                            : <LockOpen className="w-4 h-4" aria-hidden="true" />}
                                        {t("adm_unlock")}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </SettingsForm>
    );
}
