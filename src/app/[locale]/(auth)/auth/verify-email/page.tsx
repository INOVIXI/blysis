"use client";

import { useEffect, useState } from "react";
import { AuthFrame } from "@/core/components/layout/AuthFrame";
import { Card } from "@/core/components/ui/card";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/core/lib/i18n/navigation";
import { ArrowLeft, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { buttonClassName } from "@/core/components/ui/button";
import { authErrorMessage } from "@/core/lib/auth-error-message";

type Status = "verifying" | "success" | "failed";

export default function VerifyEmailPage() {
    const t = useTranslations("auth");
    const params = useSearchParams();
    const [status, setStatus] = useState<Status>("verifying");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const token = params.get("token");
        const email = params.get("email");
        if (!token || !email) {
            setStatus("failed");
            setErrorMessage(t("missingToken"));
            return;
        }

        const url = `/api/v1/auth/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
        fetch(url)
            .then(async (res) => {
                if (cancelled) return;
                if (res.ok) {
                    setStatus("success");
                } else {
                    setStatus("failed");
                    try {
                        const data = await res.json();
                        if (!cancelled) setErrorMessage(authErrorMessage(t, data, t('genericError')));
                    } catch { /* no body, or not JSON: the generic message stands */ }
                }
            })
            .catch(() => {
                if (cancelled) return;
                setStatus("failed");
            });
        return () => { cancelled = true; };
    }, [params, t]);

    return (
        <AuthFrame>
            <Card className="rounded-lg overflow-hidden">
                <div className="p-6 border-b border-border">
                    <h1 className="text-xl font-bold text-foreground text-center">{t("verifyTitle")}</h1>
                </div>

                <div className="p-6 text-center">
                    {status === "verifying" && (
                        <>
                            <Loader2 className="w-12 h-12 text-primary mx-auto mb-3 animate-spin" />
                            <p className="text-muted-foreground">{t("verifyChecking")}</p>
                        </>
                    )}
                    {status === "success" && (
                        <>
                            <CheckCircle className="w-12 h-12 text-success mx-auto mb-3" />
                            <h2 className="font-semibold text-foreground mb-2">{t("verifySuccess")}</h2>
                            <p className="text-muted-foreground text-sm mb-4">{t("verifySuccessBody")}</p>
                            <Link href="/profile" className={buttonClassName("default", "default")}>{t("backToLogin")}</Link>
                        </>
                    )}
                    {status === "failed" && (
                        <>
                            <XCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
                            <h2 className="font-semibold text-foreground mb-2">{t("verifyFailed")}</h2>
                            <p className="text-muted-foreground text-sm mb-4">
                                {errorMessage || t("verifyFailedBody")}
                            </p>
                            <Link href="/auth/login" className={buttonClassName("outline", "default")}>
                                    <ArrowLeft className="w-4 h-4" /> {t("backToLogin")}
                                </Link>
                        </>
                    )}
                </div>
            </Card>
        </AuthFrame>
    );
}
