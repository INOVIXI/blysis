"use client";

import { useState } from "react";
import { SiteName } from "@/core/components/ui/site-name";
import { Link, useRouter } from "@/core/lib/i18n/navigation";
import { Home } from "lucide-react";
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
        <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12 relative">
            <Link
                href="/"
                aria-label={t('backToHome')}
                className="absolute top-6 left-6 w-10 h-10 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
            >
                <Home className="w-5 h-5" aria-hidden="true" />
            </Link>

            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <Link href="/" className="inline-flex items-center gap-3">
                        <SiteName className="font-bold text-2xl text-foreground" />
                    </Link>
                </div>

                <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
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
                </div>
            </div>
        </div>
    );
}
