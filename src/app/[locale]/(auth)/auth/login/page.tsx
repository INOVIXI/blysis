"use client";

import { useEffect, useState } from "react";
import { SiteName } from "@/core/components/ui/site-name";
import { Link, useRouter } from "@/core/lib/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Home, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { PasswordInput } from "@/core/components/ui/password-input";
import { useTranslations, useLocale } from "next-intl";
import { useAllModules } from "@/core/providers/module-provider";
import { ModuleOauthButtons } from "@/core/generated/module-registry";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { Challenge, useChallenge } from "@/core/components/auth/Challenge";
import { CHALLENGE_FIELD } from "@/core/lib/auth-challenge-shared";
import { authErrorMessage } from "@/core/lib/auth-error-message";
import { readRefusal } from "@/core/lib/login-refusal";
import { Checkbox } from "@/core/components/ui/checkbox";
import { safeInternalPath } from "@/core/lib/safe-redirect";

const DEMO_EMAIL = "admin@example.com";
const DEMO_PASSWORD = "password123";

export default function LoginPage() {
    const router = useRouter();
    const t = useTranslations('auth');
    const locale = useLocale();
    const searchParams = useSearchParams();

    // Where this person was headed before they were asked to sign in. It comes
    // from the URL, so it comes from whoever wrote the link: `safeInternalPath`
    // is what stands between that and an open redirect, and a rejected one
    // falls back to the homepage rather than to a guess.
    const destination = safeInternalPath(searchParams.get("callbackUrl")) ?? "/";
    const challenge = useChallenge();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [needs2FA, setNeeds2FA] = useState(false);
    const [remember, setRemember] = useState(false);
    const [isDemo, setIsDemo] = useState(false);
    const allModules = useAllModules();
    // Which providers this install can actually sign somebody in with. A
    // module being installed puts a button here; having credentials is what
    // makes the button work, and Auth.js decides that at module load, so the
    // page has to ask. `null` means "not asked yet", which shows nothing -
    // buttons that appear and then vanish are worse than buttons that arrive.
    const [configuredProviders, setConfiguredProviders] = useState<string[] | null>(null);
    const oauthButtons = ModuleOauthButtons.filter(
        (b) => isEnabledIn(allModules, b.module) && (configuredProviders?.includes(b.provider) ?? false),
    );
    const [twoFactorCode, setTwoFactorCode] = useState("");

    useEffect(() => {
        fetch("/api/v1/auth/providers")
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { providers?: unknown } | null) => {
                setConfiguredProviders(Array.isArray(d?.providers) ? (d.providers as string[]) : []);
            })
            .catch(() => setConfiguredProviders([]));
    }, []);

    useEffect(() => {
        fetch("/api/v1/public-settings")
            .then((r) => r.json())
            .then((d) => { if (d?.isDemo) setIsDemo(true); })
            .catch(() => undefined);
    }, []);

    const fillDemo = () => {
        setEmail(DEMO_EMAIL);
        setPassword(DEMO_PASSWORD);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const result = await signIn("credentials", {
                // `email` carries an email address or a username - the server
                // tells them apart. The field name is part of the provider's
                // published shape, so it stays as it is.
                email,
                password,
                twoFactorCode: needs2FA ? twoFactorCode : "",
                remember: remember ? "true" : "false",
                // Whatever the auth.form.challenge slot asked to be sent, as
                // one field: Auth.js credentials are flat strings and core
                // does not know how many a module needs.
                [CHALLENGE_FIELD]: JSON.stringify(challenge.read()),
                redirect: false,
            });

            if (result?.error) {
                // Read the refusal Auth.js actually sends, which is a code and
                // never the message the server threw. Anything this build does
                // not recognise is a failure on our side, not a reader who
                // mistyped, so it must not come back as a password problem.
                const refusal = readRefusal(result);
                if (refusal.kind === "two-factor-required") {
                    setNeeds2FA(true);
                    setError("");
                } else if (refusal.kind === "invalid-two-factor") {
                    setError(t('invalidTwoFactor'));
                } else if (refusal.kind === "banned") {
                    setError(t('accountSuspended'));
                } else if (refusal.kind === "account-locked") {
                    setError(t('accountLocked'));
                } else if (refusal.kind === "too-many-attempts") {
                    setError(t('tooManyAttempts'));
                } else if (refusal.kind === "challenge-failed") {
                    // The challenge module names its own code; core looks it
                    // up the same way it does every other auth error and
                    // falls back when the module ships no string for it.
                    setError(authErrorMessage(t, { code: refusal.code }, t('challengeFailed')));
                } else if (refusal.kind === "bad-credentials") {
                    setError(t('invalidCredentials'));
                } else {
                    setError(t('genericError'));
                }
            } else {
                // If a non-TOTP (backup) code was used, warn about remaining codes.
                const submittedCode = needs2FA ? twoFactorCode.trim() : "";
                const looksLikeBackupCode = submittedCode.length > 0 && !/^\d{6}$/.test(submittedCode);
                if (looksLikeBackupCode) {
                    try {
                        const statusRes = await fetch("/api/v1/auth/two-factor/status");
                        if (statusRes.ok) {
                            const status = await statusRes.json();
                            const remaining = Number(status?.remainingBackupCodes) || 0;
                            const said = t('backupCodesRemaining', { count: remaining });
                            if (remaining <= 3) {
                                toast.warning(said);
                            } else {
                                toast.info(said);
                            }
                        }
                    } catch {
                        // silent - not critical
                    }
                }
                router.push(destination);
                router.refresh();
            }
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

                {isDemo && (
                    <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
                        <div className="flex items-start gap-3">
                            <Sparkles className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-foreground">{t('demoBanner')}</p>
                                <p className="text-muted-foreground mt-1">
                                    {t('email')}: <code className="text-foreground font-mono">{DEMO_EMAIL}</code>
                                    <br />
                                    {t('password')}: <code className="text-foreground font-mono">{DEMO_PASSWORD}</code>
                                </p>
                                <p className="text-xs text-muted-foreground mt-2">
                                    {t('demoBannerBody')}
                                </p>
                                <Button type="button" size="sm" variant="outline" className="mt-3" onClick={fillDemo}>
                                    {t('demoFillCreds')}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-border">
                        <h1 className="text-xl font-bold text-foreground text-center">{t('loginTitle')}</h1>
                        <p className="text-muted-foreground text-sm text-center mt-1">{t('loginSubtitle')}</p>
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
                                    {t('emailOrUsername')}
                                </label>
                                {/* Not type="email": the browser's own
                                    validation would refuse a username. */}
                                <Input
                                    id="email"
                                    type="text"
                                    autoComplete="username"
                                    placeholder={t('emailOrUsernamePlaceholder')}
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
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
                                    autoComplete="current-password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    showLabel={t('showPassword')}
                                    hideLabel={t('hidePassword')}
                                    className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary focus:bg-card"
                                />
                            </div>

                            {needs2FA && (
                                <div className="space-y-2 p-3 bg-primary/10 border border-primary/25 rounded-lg">
                                    <label htmlFor="twoFactorCode" className="text-sm font-medium text-primary">
                                        {t('twoFactorCode')}
                                    </label>
                                    <Input
                                        id="twoFactorCode"
                                        type="text"
                                        placeholder={t('twoFactorPlaceholder')}
                                        value={twoFactorCode}
                                        onChange={(e) => setTwoFactorCode(e.target.value)}
                                        autoFocus
                                        className="border-primary/25 bg-card text-center font-mono text-lg tracking-widest"
                                        maxLength={10}
                                    />
                                </div>
                            )}

                            <div className="flex items-center justify-between gap-3">
                                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                                    <Checkbox
                                        checked={remember}
                                        onChange={(e) => setRemember(e.target.checked)}
                                    />
                                    {t('rememberMe')}
                                </label>
                                <Link href="/auth/forgot-password" className="text-xs text-primary hover:underline">
                                    {t('forgotPassword')}
                                </Link>
                            </div>

                            <Challenge action="login" onField={challenge.onField} />

                            <Button
                                type="submit"
                                className="w-full"
                                disabled={loading}
                            >
                                {loading ? t('signingIn') : t('signIn')}
                            </Button>

                            <div className="relative my-6">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-border" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-card px-2 text-muted-foreground">{t('orContinueWith')}</span>
                                </div>
                            </div>

                            {/* OAuth buttons - from installed modules */}
                            {oauthButtons.length > 0 && (
                                    <div className={`grid ${oauthButtons.length === 1 ? "grid-cols-1" : "grid-cols-2"} gap-3`}>
                                        {oauthButtons.map(btn => (
                                            <Button key={btn.id} type="button" variant="outline"
                                                // A provider that does not start its flow the Auth.js way
                                                // (Steam opens an OpenID 2.0 redirect) names its own entry
                                                // route in the manifest; everything else goes through signIn.
                                                // The manifest schema already forbids an off-site href; this
                                                // is the second look, because getting it wrong points the
                                                // sign-in button at somebody else's login form.
                                                onClick={() => {
                                                    const href = safeInternalPath(btn.href ?? "");
                                                    if (href) {
                                                        window.location.href = href;
                                                    } else {
                                                        signIn(btn.provider, { callbackUrl: `/${locale}${destination === "/" ? "" : destination}` });
                                                    }
                                                }}
                                                className="border-border text-foreground hover:bg-muted">
                                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill={btn.color}>
                                                    {btn.svgIcon.includes("|")
                                                        ? btn.svgIcon.split("|").map((d: string, i: number) => <path key={i} d={d} />)
                                                        : <path d={btn.svgIcon} />
                                                    }
                                                </svg>
                                                {btn.label}
                                            </Button>
                                        ))}
                                    </div>
                            )}
                        </form>

                        <p className="text-center text-sm text-muted-foreground mt-6">
                            {t('noAccount')}{" "}
                            <Link href="/auth/register" className="text-primary hover:underline font-medium">
                                {t('signUp')}
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
