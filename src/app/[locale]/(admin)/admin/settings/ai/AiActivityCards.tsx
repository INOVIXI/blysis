"use client";

import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/components/ui/card";
import type { AiPurposeRow, AiUsageRow } from "./ai-screen-data";

/** A purpose's name in the module's own words, or its id when it gave none. */
function usePurposeLabel(purposes: AiPurposeRow[]) {
    const t = useTranslations("admin");
    return (module: string, purpose: string) => {
        const row = purposes.find((p) => p.module === module && p.id === purpose);
        return row && t.has(row.labelKey) ? t(row.labelKey) : purpose;
    };
}

interface AiUsageCardProps {
    usage: AiUsageRow[];
    purposes: AiPurposeRow[];
    windowDays: number;
}

export function AiUsageCard({ usage, purposes, windowDays }: AiUsageCardProps) {
    const t = useTranslations("admin");
    const locale = useLocale();
    const purposeLabel = usePurposeLabel(purposes);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{t("ai_usageTitle", { days: windowDays })}</CardTitle>
                <CardDescription>{t("ai_usageHelp")}</CardDescription>
            </CardHeader>
            <CardContent className={usage.length === 0 ? undefined : "p-0 overflow-x-auto"}>
                {usage.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("ai_usageEmpty")}</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3 font-medium">{t("ai_usageModule")}</th>
                                <th className="px-4 py-3 font-medium">{t("ai_usagePurpose")}</th>
                                <th className="px-4 py-3 font-medium text-right">{t("ai_usageRequests")}</th>
                                <th className="px-4 py-3 font-medium text-right">{t("ai_usageTokens")}</th>
                                <th className="px-4 py-3 font-medium text-right">{t("ai_usageErrors")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {usage.map((row) => (
                                <tr key={`${row.module}/${row.purpose}`} className="border-t border-border">
                                    <td className="px-4 py-3 font-mono text-xs">{row.module}</td>
                                    <td className="px-4 py-3">{purposeLabel(row.module, row.purpose)}</td>
                                    <td className="px-4 py-3 text-right tabular-nums">{row.requests.toLocaleString(locale)}</td>
                                    <td className="px-4 py-3 text-right tabular-nums">{row.tokens.toLocaleString(locale)}</td>
                                    <td className={`px-4 py-3 text-right tabular-nums ${row.errors > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                                        {row.errors.toLocaleString(locale)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </CardContent>
        </Card>
    );
}

/**
 * What leaves this site: every purpose a switched-on module declared, in its
 * own words, so the operator knows what a vendor receives before it does.
 */
export function AiPurposesCard({ purposes }: { purposes: AiPurposeRow[] }) {
    const t = useTranslations("admin");
    const purposeLabel = usePurposeLabel(purposes);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{t("ai_sendsTitle")}</CardTitle>
                <CardDescription>{t("ai_sendsHelp")}</CardDescription>
            </CardHeader>
            <CardContent>
                {purposes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("ai_sendsEmpty")}</p>
                ) : (
                    <ul className="space-y-3">
                        {purposes.map((purpose) => (
                            <li key={`${purpose.module}/${purpose.id}`} className="rounded-lg border border-border p-3">
                                <div className="flex flex-wrap items-baseline gap-2">
                                    <span className="font-medium">{purposeLabel(purpose.module, purpose.id)}</span>
                                    <span className="font-mono text-xs text-muted-foreground">{purpose.module}</span>
                                </div>
                                {t.has(purpose.sendsKey) && (
                                    <p className="mt-1 text-sm text-muted-foreground">{t(purpose.sendsKey)}</p>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
