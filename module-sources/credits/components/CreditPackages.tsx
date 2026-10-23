"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button, Card, CardContent, CardHeader, CardTitle, useSiteCurrency } from "@/core/sdk/ui";
import { dateLocaleTag, errorMessage } from "@/core/sdk";
import { Loader2 } from "lucide-react";

interface CreditPackage {
    id: string;
    name: string;
    credits: number;
    bonusCredits: number;
    price: number;
}

/**
 * The packages a member can buy.
 *
 * The bonus is shown as its own line rather than folded into one number,
 * because it is the whole reason to pick the larger package. A shop that has
 * defined none draws nothing here and keeps whatever it had.
 */
export function CreditPackages({ onBought }: { onBought: () => void }) {
    const t = useTranslations("credits");
    const commonT = useTranslations("common");
    // The reader's locale, not the renderer's: a thousand is 1,000 or 1.000
    // depending on who is looking at it.
    const numberTag = dateLocaleTag(useLocale());
    const { format: money } = useSiteCurrency();
    const [packages, setPackages] = useState<CreditPackage[]>([]);
    const [buying, setBuying] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/store/credit-packages")
            .then((res) => (res.ok ? res.json() : { packages: [] }))
            .then((data) => { if (!cancelled) setPackages(Array.isArray(data.packages) ? data.packages : []); })
            .catch(() => { if (!cancelled) setPackages([]); });
        return () => { cancelled = true; };
    }, []);

    if (packages.length === 0) return null;

    const buy = async (id: string) => {
        setBuying(id);
        try {
            const res = await fetch("/api/v1/store/credits/buy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ packageId: id }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.redirect) {
                toast.error(errorMessage(data, t("buy_failed"), t));
                return;
            }
            // The gateway's own page. Credits are granted when it settles,
            // never here.
            window.location.href = data.redirect;
            onBought();
        } catch {
            toast.error(commonT("somethingWentWrong"));
        } finally {
            setBuying(null);
        }
    };

    return (
        <Card>
            <CardHeader><CardTitle>{t("buy_title")}</CardTitle></CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {packages.map((pack) => (
                        <div key={pack.id} className="rounded-lg border border-border p-4">
                            <p className="font-medium">{pack.name}</p>
                            <p className="mt-1 text-2xl font-bold">{pack.credits.toLocaleString(numberTag)}</p>
                            {pack.bonusCredits > 0 && (
                                <p className="text-sm text-success">
                                    {t("buy_bonus", { count: pack.bonusCredits })}
                                </p>
                            )}
                            <p className="mt-2 text-sm text-muted-foreground">{money(pack.price)}</p>
                            <Button
                                className="mt-3 w-full"
                                size="sm"
                                disabled={buying !== null}
                                onClick={() => buy(pack.id)}
                            >
                                {buying === pack.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                {t("buy_buy")}
                            </Button>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
