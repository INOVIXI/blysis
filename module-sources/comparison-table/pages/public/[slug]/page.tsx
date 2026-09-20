"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { PageFrame } from "@/core/sdk/layout";
import { Card, CardContent, LoadFailed } from "@/core/sdk/ui";
import { Loader2 } from "lucide-react";
import { ComparisonGrid, type GridTable } from "../../../components/ComparisonGrid";

/**
 * One comparison on its own page.
 *
 * The drawing is `ComparisonGrid`, which a shelf displayed as a comparison
 * uses too: two renderers of one table drift, and the half that drifts is
 * always the one nobody opened this week.
 */
export default function ComparisonTablePage() {
    const t = useTranslations("comparisonTable");
    const locale = useLocale();
    // A module page is served through core's catch-all, so `useParams` hands
    // back the whole path (`["compare", "plans"]`) rather than this route's
    // own `[slug]`. Reading it as a string gave "compare,plans" and every
    // lookup missed - which the page then showed as a failed load.
    const routed = useParams()?.slug;
    const segments = Array.isArray(routed) ? routed : typeof routed === "string" ? routed.split("/") : [];
    const slug = segments[segments.length - 1] ?? "";
    const [table, setTable] = useState<GridTable | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        if (!slug) return;
        let cancelled = false;
        setLoading(true);
        fetch(`/api/v1/comparison-tables?slug=${encodeURIComponent(slug)}&locale=${locale}`)
            .then((res) => { if (!res.ok) throw new Error("load"); return res.json(); })
            .then((data) => { if (!cancelled) { setTable(data.table ?? null); setFailed(false); } })
            .catch(() => { if (!cancelled) setFailed(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [slug, locale, reloadKey]);

    if (loading) {
        return (
            <PageFrame title={t("title")}>
                <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            </PageFrame>
        );
    }

    if (failed) {
        return (
            <PageFrame title={t("title")}>
                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
            </PageFrame>
        );
    }

    if (!table) {
        return (
            <PageFrame title={t("title")}>
                <Card><CardContent className="py-12 text-center"><p className="text-muted-foreground">{t("notFound")}</p></CardContent></Card>
            </PageFrame>
        );
    }

    return (
        <PageFrame title={table.title} description={table.description ?? undefined}>
            <Card>
                <CardContent className="p-0">
                    <ComparisonGrid table={table} />
                </CardContent>
            </Card>
            <p className="mt-3 text-xs text-muted-foreground">{t("unstatedNote")}</p>
        </PageFrame>
    );
}
