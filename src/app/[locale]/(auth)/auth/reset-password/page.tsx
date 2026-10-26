"use client";

import { useState } from "react";
import { AuthFrame } from "@/core/components/layout/AuthFrame";
import { Card } from "@/core/components/ui/card";
import { Link } from "@/core/lib/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { CheckCircle } from "lucide-react";
import { Button, buttonClassName } from "@/core/components/ui/button";
import { PasswordInput } from "@/core/components/ui/password-input";
import { useTranslations } from "next-intl";
import { authErrorMessage } from "@/core/lib/auth-error-message";

export default function ResetPasswordPage() {
    const t = useTranslations('auth');
    const searchParams = useSearchParams();
    const token = searchParams.get("token") || "";
    const email = searchParams.get("email") || "";

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (password !== confirmPassword) {
            setError(t('passwordsDontMatch'));
            return;
        }

        if (password.length < 6) {
            setError(t('passwordMinLength'));
            return;
        }

        setLoading(true);

        try {
            const res = await fetch("/api/v1/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, token, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(authErrorMessage(t, data, t('genericError')));
                return;
            }

            setSuccess(true);
        } catch {
            setError(t('genericError'));
        } finally {
            setLoading(false);
        }
    };

    if (!token || !email) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center px-4">
                <div className="text-center">
                    <h1 className="text-xl font-bold text-foreground mb-2">{t('invalidResetLink')}</h1>
                    <p className="text-muted-foreground mb-4">{t('invalidResetLinkBody')}</p>
                    <Link href="/auth/forgot-password" className={buttonClassName("default", "default")}>{t('sendResetLink')}</Link>
                </div>
            </div>
        );
    }

    return (
        <AuthFrame>
            <Card className="rounded-lg overflow-hidden">
                <div className="p-6 border-b border-border">
                    <h1 className="text-xl font-bold text-foreground text-center">{t('resetTitle')}</h1>
                    <p className="text-muted-foreground text-sm text-center mt-1">{t('resetSubtitle')}</p>
                </div>

                <div className="p-6">
                    {success ? (
                        <div className="text-center py-4">
                            <CheckCircle className="w-12 h-12 text-success mx-auto mb-3" />
                            <h2 className="font-semibold text-foreground mb-1">{t('resetSuccess')}</h2>
                            <p className="text-muted-foreground text-sm mb-4">
                                {t('resetSuccessBody')}
                            </p>
                            <Link href="/auth/login" className={buttonClassName("default", "default", "bg-primary hover:bg-primary/90 text-primary-foreground")}>
                                    {t('signIn')}
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
                                <label htmlFor="password" className="text-sm font-medium text-foreground">
                                    {t('password')}
                                </label>
                                <PasswordInput
                                    id="password"
                                    autoComplete="new-password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    className="border-border bg-muted"
                                    showLabel={t('showPassword')}
                                    hideLabel={t('hidePassword')}
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">
                                    {t('confirmPassword')}
                                </label>
                                <PasswordInput
                                    id="confirmPassword"
                                    autoComplete="new-password"
                                    placeholder="••••••••"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    className="border-border bg-muted"
                                    showLabel={t('showPassword')}
                                    hideLabel={t('hidePassword')}
                                />
                            </div>

                            <Button
                                type="submit"
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                                disabled={loading}
                            >
                                {loading ? t('resetting') : t('resetButton')}
                            </Button>
                        </form>
                    )}
                </div>
            </Card>
        </AuthFrame>
    );
}
