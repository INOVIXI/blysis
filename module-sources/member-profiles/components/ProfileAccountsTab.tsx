"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Loader2 } from "lucide-react";
import { SIGN_IN_METHODS_SECTION } from "@/core/sdk";
import { Link } from "@/core/sdk/navigation";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    LoadFailed,
    ProviderMark,
    providerLabel,
    useLocalDate,
} from "@/core/sdk/ui";

interface LinkedAccount {
    provider: string;
    username: string | null;
}

interface SignInMethod {
    provider: string;
    providerAccountId: string;
    displayName: string | null;
    connectedAt: string | null;
}

/**
 * The accounts a member has proved are theirs.
 *
 * This had a text box: type any in-game name, press Link, and it was recorded
 * as yours and published on your profile with nothing checking it. The name
 * was first come first served, so somebody else's was there for the taking.
 * It also said accounts you sign in with are linked automatically, which
 * nothing did - that box was the only writer there had ever been.
 *
 * It reads now, and does not write. A module that can reach the other side
 * proves the account is yours and answers `profile.linkedAccounts`;
 * `minecraft-link` whispers a code in game and waits for it to come back.
 * Unlinking belongs to that module too, beside the step that made the link.
 *
 * The sign-in methods the member connected are listed here as well, because
 * a member who connected Discord looks for it under linked accounts. They are
 * managed in the account page's sign-in methods section, so each one links
 * there rather than carrying a second connect or disconnect.
 */
export function ProfileAccountsTab() {
    const t = useTranslations("memberProfiles");
    const formatDate = useLocalDate({ dateStyle: "medium" });
    const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
    const [signInMethods, setSignInMethods] = useState<SignInMethod[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch("/api/v1/linked-accounts")
            .then((res) => {
                if (!res.ok) throw new Error(String(res.status));
                return res.json();
            })
            .then((data: { accounts?: LinkedAccount[]; signInMethods?: SignInMethod[] }) => {
                if (cancelled) return;
                setAccounts(data.accounts ?? []);
                setSignInMethods(data.signInMethods ?? []);
                // A read that worked lowers the flag, or the panel outlives
                // the outage and a retry that worked changes nothing.
                setFailed(false);
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                // Not an empty list. "You have linked nothing" and "we could
                // not find out" are different answers and this used to give
                // the first for both.
                setFailed(true);
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [reloadKey]);

    return (
        <Card>
            <CardHeader><CardTitle>{t("linkedAccounts")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                {loading ? (
                    <div className="flex justify-center py-6">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                ) : failed ? (
                    <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
                ) : accounts.length > 0 || signInMethods.length > 0 ? (
                    <div className="space-y-2">
                        {accounts.map((account) => (
                            <div
                                key={`${account.provider}:${account.username ?? ""}`}
                                className="flex items-center gap-3 p-3 bg-muted rounded-lg"
                            >
                                <span className="capitalize font-medium">{account.provider}</span>
                                {account.username && (
                                    <span className="text-sm text-muted-foreground">{account.username}</span>
                                )}
                            </div>
                        ))}
                        {signInMethods.map((method) => {
                            const label = providerLabel(method.provider);
                            return (
                                <Link
                                    key={`sign-in:${method.provider}`}
                                    href={`/profile?section=${SIGN_IN_METHODS_SECTION}`}
                                    aria-label={t("signInMethod_manage", { provider: label })}
                                    className="flex items-center gap-3 p-3 bg-muted rounded-lg hover:bg-muted/70 transition-colors"
                                >
                                    <ProviderMark provider={method.provider} />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium">{label}</div>
                                        <div className="text-sm text-muted-foreground truncate">
                                            {[
                                                method.displayName ?? method.providerAccountId,
                                                method.connectedAt
                                                    ? t("signInMethod_connectedOn", { date: formatDate(method.connectedAt) })
                                                    : null,
                                            ].filter(Boolean).join(" · ")}
                                        </div>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                                </Link>
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">{t("noLinkedAccounts")}</p>
                )}
                <p className="text-xs text-muted-foreground">{t("linksAreManagedByTheirModule")}</p>
            </CardContent>
        </Card>
    );
}
