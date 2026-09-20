"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent, CardHeader, CardTitle, LoadFailed } from "@/core/sdk/ui";
import { Download, Loader2 } from "lucide-react";
import { AdminPageHeader } from "@/core/sdk/admin";

/**
 * What this site can hand over as a table.
 *
 * The buttons were written here: members, products, orders, against an
 * endpoint that knew about members. Pressing either of the other two opened a
 * new tab showing `{"error":"Invalid type. Use: users"}`, because `Product`
 * and `Order` belong to the shop and this module cannot read another module's
 * tables. The endpoint asks whatever is installed now, and this draws the
 * answer, so a site with no shop is offered no shop exports and a site with
 * one is offered them without this file naming it.
 */
interface Offered {
    id: string;
    /** A full key, namespace and all: the words belong to whoever offered it. */
    labelKey: string;
}

export default function ExportPage() {
    const t = useTranslations("csvImportExport");
    // The root catalogue, because a label lives in the namespace of the
    // module that offered the export rather than in this one.
    const anyT = useTranslations();
    const [offered, setOffered] = useState<Offered[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch("/api/v1/admin/export")
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error("read failed"))))
            .then((data) => {
                if (cancelled) return;
                setOffered(Array.isArray(data.exports) ? data.exports : []);
                setFailed(false);
            })
            .catch(() => { if (!cancelled) setFailed(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [attempt]);

    // A label a catalogue has no word for falls back to the id rather than
    // rendering the key at the operator, which is the one thing a machine
    // name must never do.
    const nameOf = (one: Offered) => (anyT.has(one.labelKey) ? anyT(one.labelKey) : one.id);

    return (
        <>
            <AdminPageHeader title={t("adm_exportTitle")} description={t("adm_exportSubtitle")} />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t("adm_export")}</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-6">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
                        </div>
                    ) : failed ? (
                        <LoadFailed onRetry={() => setAttempt((n) => n + 1)} />
                    ) : offered.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("adm_nothingToExport")}</p>
                    ) : (
                        /* Across the card rather than stacked in a 28rem
                           column: the screen offers one kind of thing several
                           times, and a row says that better than a list. */
                        <div className="grid gap-3 sm:grid-cols-3">
                            {offered.map((one) => (
                                <Button
                                    key={one.id}
                                    variant="outline"
                                    className="w-full justify-start"
                                    onClick={() => window.open(`/api/v1/admin/export?type=${one.id}`, "_blank")}
                                >
                                    <Download className="w-4 h-4" aria-hidden="true" /> {nameOf(one)}
                                </Button>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </>
    );
}
