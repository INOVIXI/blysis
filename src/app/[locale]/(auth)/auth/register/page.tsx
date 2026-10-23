"use client";

import { useState } from "react";
import { AuthFrame } from "@/core/components/layout/AuthFrame";
import { Card } from "@/core/components/ui/card";
import { Link, useRouter } from "@/core/lib/i18n/navigation";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { PasswordInput } from "@/core/components/ui/password-input";
import { useTranslations } from "next-intl";
import { authErrorMessage } from "@/core/lib/auth-error-message";
import { Challenge, useChallenge } from "@/core/components/auth/Challenge";
import { CHALLENGE_FIELD } from "@/core/lib/auth-challenge-shared";

export default function RegisterPage() {
    const router = useRouter();
    const t = useTranslations('auth');
    const challenge = useChallenge();
    const [formData, setFormData] = useState({
        email: "",
        username: "",
        password: "",
        confirmPassword: "",
    });
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData((prev) => ({
            ...prev,
            [e.target.name]: e.target.value,
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (formData.password !== formData.confirmPassword) {
            setError(t('passwordsDontMatch'));
            return;
        }

        setLoading(true);

        try {
            const response = await fetch("/api/v1/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...formData, [CHALLENGE_FIELD]: challenge.read() }),
            });

            const data = await response.json();

            if (!response.ok) {
                setError(authErrorMessage(t, data, t('genericError')));
                return;
            }

            router.push("/auth/login?registered=true");
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
                    <h1 className="text-xl font-bold text-foreground text-center">{t('registerTitle')}</h1>
                    <p className="text-muted-foreground text-sm text-center mt-1">{t('registerSubtitle')}</p>
                </div>

                <div className="p-6">
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
                                name="email"
                                type="email"
                                placeholder={t('emailPlaceholder')}
                                value={formData.email}
                                onChange={handleChange}
                                required
                                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary focus:bg-card"
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="username" className="text-sm font-medium text-foreground">
                                {t('username')}
                            </label>
                            <Input
                                id="username"
                                name="username"
                                type="text"
                                placeholder={t('usernamePlaceholder')}
                                value={formData.username}
                                onChange={handleChange}
                                required
                                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary focus:bg-card"
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="password" className="text-sm font-medium text-foreground">
                                {t('password')}
                            </label>
                            <PasswordInput
                                id="password"
                                name="password"
                                autoComplete="new-password"
                                placeholder="••••••••"
                                value={formData.password}
                                onChange={handleChange}
                                required
                                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary focus:bg-card"
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
                                name="confirmPassword"
                                autoComplete="new-password"
                                placeholder="••••••••"
                                value={formData.confirmPassword}
                                onChange={handleChange}
                                required
                                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary focus:bg-card"
                                showLabel={t('showPassword')}
                                hideLabel={t('hidePassword')}
                            />
                        </div>

                        <Challenge action="register" onField={challenge.onField} />

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={loading}
                        >
                            {loading ? t('creatingAccount') : t('registerTitle')}
                        </Button>
                    </form>

                    <p className="text-center text-sm text-muted-foreground mt-6">
                        {t('hasAccount')}{" "}
                        <Link href="/auth/login" className="text-primary hover:underline font-medium">
                            {t('signIn')}
                        </Link>
                    </p>
                </div>
            </Card>
        </AuthFrame>
    );
}
