"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, LoadFailed, Waiting } from "@/core/sdk/ui";
import { useLocale, useTranslations } from "next-intl";
import { ComparisonGrid, type GridTable } from "../components/ComparisonGrid";

/**
 * A shelf drawn as a comparison.
 *
 * The shop decides that a category is a ladder rather than a grid, and emits
 * this slot in the grid's place. This module answers with the table about that
 * category, whose columns are the category's own products - their live names,
 * prices and pictures - and whose rows are what the operator wrote.
 *
 * It knows nothing about shops. The subject is an opaque string the shop
 * minted and handed over; if this module is not installed the slot renders
 * nothing and the shop draws its grid, and if the shop is not installed the
 * slot never exists. Neither imports the other.
 *
 * Nothing yet written is nothing drawn, not an empty frame: a category
 * switched to a table before anybody wrote a row should look unfinished to
 * its operator and like an ordinary shelf to everybody else.
 *
 * A read that fails is a different answer and gets a different screen. The
 * shelf has handed its whole contents to this component - the store draws no
 * grid behind it - so swallowing a failure leaves a category page with
 * nothing on it at all, which reads as "this shop sells nothing".
 */
export default function ShelfTable({ subjectRef }: { subjectRef?: string }) {
    const t = useTranslations("comparisonTable");
    const locale = useLocale();
    const [table, setTable] = useState<GridTable | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        if (!subjectRef) { setLoading(false); return; }
        let cancelled = false;
        setLoading(true);
        fetch(`/api/v1/comparison-tables?subject=${encodeURIComponent(subjectRef)}&locale=${locale}`)
            .then((res) => {
                // No table about this shelf yet is an answer, not a failure:
                // somebody switched the category over before writing one.
                if (res.status === 404) return { table: null };
                if (!res.ok) return Promise.reject(new Error(String(res.status)));
                return res.json();
            })
            .then((data: { table?: GridTable | null }) => {
                if (cancelled) return;
                setTable(data.table ?? null);
                setFailed(false);
            })
            .catch(() => { if (!cancelled) setFailed(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [subjectRef, locale, reloadKey]);

    if (loading) return <Waiting label={t("title")} />;
    if (failed) return <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />;
    if (!table || table.columns.length === 0) return null;

    return (
        <>
            <Card>
                <CardContent className="p-0">
                    <ComparisonGrid table={table} />
                </CardContent>
            </Card>
            <p className="mt-3 text-xs text-muted-foreground">{t("unstatedNote")}</p>
        </>
    );
}
