"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Monitor, Smartphone } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/core/lib/i18n/navigation";
import { Badge } from "@/core/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { dateLocaleTag, formatDate } from "@/core/lib/utils";
import { MemberRestrictions, type RestrictionRow } from "./MemberRestrictions";

/**
 * One member, from every angle at once, on the screen that is already about
 * them.
 *
 * The endpoint behind this asks whatever is installed what it knows and never
 * learns who answered, so what appears here is not a list core wrote: a shop
 * contributes what they bought, a credit ledger what they are owed, a support
 * desk what they have asked for. Core renders whatever comes back and names
 * none of it.
 *
 * It is a second request rather than part of the page's own, because the page
 * is an edit form that has to render before a filter over every installed
 * module has finished. A slow panel delays a panel, not the screen.
 */

interface Panel {
    key: string;
    label: string;
    rows: { label: string; value: string }[];
    href?: string;
}

interface Login {
    id: string;
    ipAddress: string | null;
    lastActiveAt: string;
    current: boolean;
    agent: { browser: string | null; os: string | null; mobile: boolean; raw: string | null };
}

interface CustomerResponse {
    logins: Login[];
    restrictions: RestrictionRow[];
    panels: Panel[];
}

export function CustomerView({ userId }: { userId: string }) {
    const t = useTranslations("admin");
    const dateTag = dateLocaleTag(useLocale());

    const [data, setData] = useState<CustomerResponse | null>(null);
    const [scopes, setScopes] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
            const [view, suggestions] = await Promise.all([
                fetch(`/api/v1/admin/customers/${userId}`),
                fetch(`/api/v1/admin/customers/${userId}/restrictions`),
            ]);
            if (!view.ok) throw new Error("view");
            setData(await view.json());
            if (suggestions.ok) {
                const body = await suggestions.json();
                setScopes(body?.data?.scopes ?? []);
            }
        } catch {
            // Said rather than shown as an empty member: this screen is the
            // one an operator opens to decide something.
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        void load();
    }, [load]);

    if (loading) {
        return (
            <Card>
                <CardContent className="flex justify-center py-10">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden="true" />
                </CardContent>
            </Card>
        );
    }

    if (failed || !data) {
        return <Card><CardContent><LoadFailed onRetry={load} /></CardContent></Card>;
    }

    return (
        <div className="space-y-6">
            {data.panels.map((panel) => (
                <Card key={panel.key}>
                    <CardHeader>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <CardTitle>{panel.label}</CardTitle>
                            {panel.href ? (
                                <Link href={panel.href} className="text-sm text-primary hover:underline">
                                    {t("customer_openModule")}
                                </Link>
                            ) : null}
                        </div>
                    </CardHeader>
                    <CardContent>
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                            {panel.rows.map((row) => (
                                <div key={row.label} className="flex justify-between gap-3">
                                    <dt className="text-muted-foreground">{row.label}</dt>
                                    <dd className="font-medium tabular-nums">{row.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </CardContent>
                </Card>
            ))}

            <MemberRestrictions
                userId={userId}
                restrictions={data.restrictions}
                scopes={scopes}
                onChange={(restrictions) => setData({ ...data, restrictions })}
            />

            <Card>
                <CardHeader>
                    <CardTitle>{t("customer_logins")}</CardTitle>
                    <p className="text-sm text-muted-foreground">{t("customer_loginsHint")}</p>
                </CardHeader>
                <CardContent>
                    {data.logins.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("customer_noLogins")}</p>
                    ) : (
                        <ul className="space-y-3 text-sm">
                            {data.logins.map((login) => (
                                <li key={login.id} className="flex items-start justify-between gap-3 flex-wrap">
                                    <div className="flex items-start gap-2 min-w-0">
                                        {login.agent.mobile
                                            ? <Smartphone className="w-4 h-4 mt-0.5 text-muted-foreground" aria-hidden="true" />
                                            : <Monitor className="w-4 h-4 mt-0.5 text-muted-foreground" aria-hidden="true" />}
                                        <div className="min-w-0">
                                            <p className="font-medium">
                                                {/* An unfamiliar string serves
                                                    "was this me" better than a
                                                    confident wrong answer. */}
                                                {login.agent.browser ?? t("customer_unknownBrowser")}
                                                {login.agent.os ? ` - ${login.agent.os}` : ""}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {login.ipAddress ?? t("customer_unknownIp")}
                                                {" - "}
                                                {formatDate(new Date(login.lastActiveAt), undefined, dateTag)}
                                            </p>
                                        </div>
                                    </div>
                                    {login.current ? <Badge tone="success">{t("customer_signedIn")}</Badge> : null}
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
