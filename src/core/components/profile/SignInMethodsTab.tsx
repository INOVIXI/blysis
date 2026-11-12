"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { useLocalDate } from "@/core/hooks/useLocalDate";
import { useRouter } from "@/core/lib/i18n/navigation";
import { errorMessage } from "@/core/lib/write-result";
import { ProviderMark, providerButton, providerLabel } from "@/core/components/auth/ProviderMark";
import {
    CONNECT_ERROR_PARAM,
    CONNECTED_PARAM,
    SIGN_IN_METHODS_SECTION,
    isConnectRefusal,
    type ConnectRefusal,
} from "@/core/lib/sign-in-methods-shared";

interface SignInMethod {
    provider: string;
    providerAccountId: string;
    displayName: string | null;
    connectedAt: string | null;
}

interface MethodsResponse {
    methods: SignInMethod[];
    connectable: string[];
}

/** Written out so every key is one a scan of the tree can find. */
const REFUSAL_KEYS: Record<ConnectRefusal, string> = {
    taken: "profile.signInMethods_errTaken",
    not_started: "profile.signInMethods_errNotStarted",
    already_connected: "auth.err.already_connected",
    impersonating: "auth.err.impersonating",
    connect_first: "profile.signInMethods_errNotStarted",
};

/**
 * The providers a member can sign in with, beside the password they have.
 *
 * A connect leaves the site for the provider and comes back by navigation,
 * not by a fetch, so its result arrives in the address: `connected` when it
 * worked, `connectError` with a code when the sign-in callback refused. Both
 * are read once and taken off the address, so a reload does not toast again.
 */
export function SignInMethodsTab() {
    const t = useTranslations("profile");
    // The API's refusals carry an `auth.err` code, and the callback's land
    // in either namespace, so both are read from the root.
    const rootT = useTranslations();
    const authT = useTranslations("auth");
    const locale = useLocale();
    const router = useRouter();
    const params = useSearchParams();
    const formatDate = useLocalDate({ dateStyle: "medium" });
    const { confirm } = useConfirm();
    const [data, setData] = useState<MethodsResponse | null>(null);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const announced = useRef(false);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const res = await fetch("/api/v1/auth/sign-in-methods");
            if (!res.ok) throw new Error("load failed");
            const body = (await res.json()) as MethodsResponse;
            setData(body);
            return body;
        } catch {
            setFailed(true);
            return null;
        }
    }, []);

    useEffect(() => {
        load().then((body) => {
            if (!body || announced.current) return;
            const connected = params.get(CONNECTED_PARAM);
            const refused = params.get(CONNECT_ERROR_PARAM);
            if (!connected && !refused) return;
            announced.current = true;
            // Only a provider that really is connected now is announced: the
            // address is something anybody can type.
            if (connected && body.methods.some((method) => method.provider === connected)) {
                toast.success(t("signInMethods_connected", { provider: providerLabel(connected) }));
            } else if (isConnectRefusal(refused)) {
                toast.error(rootT(REFUSAL_KEYS[refused]));
            }
            router.replace(`/profile?section=${SIGN_IN_METHODS_SECTION}`);
        });
    }, [load, params, router, t, rootT]);

    const connect = async (provider: string) => {
        setBusy(provider);
        try {
            const res = await fetch("/api/v1/auth/sign-in-methods", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ provider }),
            });
            if (!res.ok) {
                toast.error(errorMessage(await res.json().catch(() => ({})), t("signInMethods_failed"), authT));
                setBusy(null);
                return;
            }
            const back = `/${locale}/profile?section=${SIGN_IN_METHODS_SECTION}&${CONNECTED_PARAM}=${encodeURIComponent(provider)}`;
            await signIn(provider, { callbackUrl: back });
        } catch {
            toast.error(t("signInMethods_failed"));
            setBusy(null);
        }
    };

    const disconnect = async (provider: string) => {
        const label = providerLabel(provider);
        const ok = await confirm({
            title: t("signInMethods_disconnectTitle", { provider: label }),
            message: t("signInMethods_disconnectMessage", { provider: label }),
            confirmText: t("signInMethods_disconnect"),
            variant: "danger",
        });
        if (!ok) return;
        setBusy(provider);
        try {
            const res = await fetch(`/api/v1/auth/sign-in-methods/${encodeURIComponent(provider)}`, { method: "DELETE" });
            if (!res.ok) {
                toast.error(errorMessage(await res.json().catch(() => ({})), t("signInMethods_failed"), authT));
                return;
            }
            toast.success(t("signInMethods_disconnected", { provider: label }));
            await load();
        } catch {
            toast.error(t("signInMethods_failed"));
        } finally {
            setBusy(null);
        }
    };

    if (failed) return <Card><CardContent><LoadFailed onRetry={load} /></CardContent></Card>;
    if (!data) {
        return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-label={t("loadingProfile")} /></div>;
    }

    // What can be connected is what has a button that goes through Auth.js;
    // what is connected is listed whatever happened to its module since.
    const offered = data.connectable.filter((provider) => {
        const button = providerButton(provider);
        return button !== null && !button.href;
    });
    const providers = [...new Set([...offered, ...data.methods.map((method) => method.provider)])];

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("signInMethods")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{t("signInMethods_hint")}</p>
                {providers.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">{t("signInMethods_none")}</p>
                ) : (
                    <ul className="space-y-2">
                        {providers.map((provider) => {
                            const method = data.methods.find((m) => m.provider === provider);
                            const label = providerLabel(provider);
                            return (
                                <li key={provider} className="flex items-center gap-3 p-3 border border-border rounded-lg">
                                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                        <ProviderMark provider={provider} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm text-foreground">{label}</div>
                                        <div className="text-xs text-muted-foreground truncate">
                                            {method
                                                ? [
                                                      method.displayName ?? method.providerAccountId,
                                                      method.connectedAt
                                                          ? t("signInMethods_connectedOn", { date: formatDate(method.connectedAt) })
                                                          : null,
                                                  ].filter(Boolean).join(" · ")
                                                : t("signInMethods_notConnected")}
                                        </div>
                                    </div>
                                    {method ? (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-destructive"
                                            onClick={() => disconnect(provider)}
                                            disabled={busy !== null}
                                            aria-label={t("signInMethods_disconnectTitle", { provider: label })}
                                        >
                                            {busy === provider ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                            {t("signInMethods_disconnect")}
                                        </Button>
                                    ) : offered.includes(provider) ? (
                                        <Button
                                            size="sm"
                                            onClick={() => connect(provider)}
                                            disabled={busy !== null}
                                            aria-label={t("signInMethods_connectLabel", { provider: label })}
                                        >
                                            {busy === provider ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                            {t("signInMethods_connect")}
                                        </Button>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
