"use client";

import { useState } from "react";
import { AuthFrame } from "@/core/components/layout/AuthFrame";
import { Card } from "@/core/components/ui/card";
import { Link } from "@/core/lib/i18n/navigation";
import { ArrowLeft, CheckCircle } from "lucide-react";
import { Button, buttonClassName } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { useTranslations } from "next-intl";
import { authErrorMessage } from "@/core/lib/auth-error-message";
import { Challenge, useChallenge } from "@/core/components/auth/Challenge";
import { CHALLENGE_FIELD } from "@/core/lib/auth-challenge-shared";

export default function ForgotPasswordPage() {
    const t = useTranslations('auth');
    const challenge = useChallenge();
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const res = await fetch("/api/v1/auth/forgot-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, [CHALLENGE_FIELD]: challenge.read() }),
            });

            if (res.ok) {
                setSent(true);
            } else {
                const data = await res.json();
                setError(authErrorMessage(t, data, t('genericError')));
            }
        } catch {
            setError(t('genericError'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthFrame>
            <Card className="rounded-lg overflow-hidden">
                <div className="p-6 border-b border-border">
                    <h1 className="text-xl font-bold text-foreground text-center">{t('forgotPassword')}</h1>
                    <p className="text-muted-foreground text-sm text-center mt-1">
                        {t('forgotSubtitle')}
                    </p>
                </div>

                <div className="p-6">
                    {sent ? (
                        <div className="text-center py-4">
                            <CheckCircle className="w-12 h-12 text-success mx-auto mb-3" />
                            <h2 className="font-semibold text-foreground mb-1">{t('checkEmail')}</h2>
                            <p className="text-muted-foreground text-sm mb-4">
                                {t('resetLinkSent', { email })}
                            </p>
                            <Link href="/auth/login" className={buttonClassName("outline", "default")}>
                                    <ArrowLeft className="w-4 h-4" /> {t('backToLogin')}
                                </Link>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {error && (
                                <div role="alert" className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                                    {error}
                                </div>
                            )}

                            <div className="space-y-2">
                                <label htmlFor="email" className="text-sm font-medium text-foreground">
                                    {t('email')}
                                </label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder={t('emailPlaceholder')}
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="border-border bg-muted"
                                />
                            </div>

                            <Challenge action="forgotPassword" onField={challenge.onField} />

                            <Button
                                type="submit"
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                                disabled={loading}
                            >
                                {loading ? t('sending') : t('sendResetLink')}
                            </Button>

                            <p className="text-center text-sm text-muted-foreground">
                                <Link href="/auth/login" className="text-primary hover:underline">
                                    <ArrowLeft className="w-3 h-3 inline mr-1" />
                                    {t('backToLogin')}
                                </Link>
                            </p>
                        </form>
                    )}
                </div>
            </Card>
        </AuthFrame>
    );
}
