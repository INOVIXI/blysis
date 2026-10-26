"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Card, CardContent, LoadFailed, buttonClassName } from "@/core/sdk/ui";
import { ArrangedClientPage } from "@/core/sdk/layout";
import { Link } from "@/core/sdk/navigation";
import { Loader2 } from "lucide-react";

/**
 * Where the buyer lands after choosing to pay by hand.
 *
 * It has one job: say where to send the money and what to write on it. The
 * instructions are read from the server rather than carried in the URL, since
 * an operator changes them and every link already sent should say the new
 * thing.
 *
 * The reference is in the URL and the amount is not. The buyer has to quote
 * something and their own order number is not a secret; a total in a query
 * string is a number anybody can edit, and the order is where the real one
 * lives.
 */
export default function PaymentInstructionsPage() {
    const t = useTranslations("manualPaymentGateway");
    const reference = useSearchParams()?.get("reference") ?? "";
    const [instructions, setInstructions] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/manual-payment/instructions")
            .then((res) => { if (!res.ok) throw new Error("load"); return res.json(); })
            .then((data) => {
                if (cancelled) return;
                setInstructions(typeof data.instructions === "string" ? data.instructions : "");
                setFailed(false);
            })
            .catch(() => { if (!cancelled) setFailed(true); })
            .finally(() => { if (!cancelled) setInstructions((current) => current ?? ""); });
        return () => { cancelled = true; };
    }, [reloadKey]);

    return (
        <ArrangedClientPage
            page="manual-payment-gateway.instructions"
            frame={{ title: t("title"), description: t("subtitle") }}
            blocks={{
                instructions: () => (
                    <Card>
                        <CardContent className="space-y-6 p-6">
                            {failed ? (
                                <LoadFailed onRetry={() => { setFailed(false); setReloadKey((k) => k + 1); }} />
                            ) : instructions === null ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : (
                                <>
                                    {reference && (
                                        <div>
                                            <p className="text-sm text-muted-foreground">{t("quoteThis")}</p>
                                            <p className="mt-1 font-mono text-lg font-medium">{reference}</p>
                                        </div>
                                    )}
                                    <p className="whitespace-pre-wrap text-foreground">{instructions}</p>
                                    <p className="text-sm text-muted-foreground">{t("thenWhat")}</p>
                                    <Link href="/profile" className={buttonClassName("default", "default")}>
                                        {t("myOrders")}
                                    </Link>
                                </>
                            )}
                        </CardContent>
                    </Card>
                ),
            }}
        />
    );
}
