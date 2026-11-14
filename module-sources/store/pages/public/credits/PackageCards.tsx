"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button, useSiteCurrency } from "@/core/sdk/ui";
import { dateLocaleTag } from "@/core/sdk";
import { Loader2 } from "lucide-react";

/** One package, as `GET /store/credit-packages` describes it. */
export interface CreditPackageOffer {
    id: string;
    name: string;
    credits: number;
    bonusCredits: number;
    price: number;
    /** What a running bonus campaign adds, worked out by the store. */
    campaignBonus?: { percent: number; credits: number } | null;
}

interface PackageCardsProps {
    packages: CreditPackageOffer[];
    /** Whether a campaign is still running on the reader's clock. */
    campaignLive: boolean;
    buying: string | null;
    /** No gateway can take the money, so nothing can be bought. */
    disabled: boolean;
    onBuy: (packageId: string) => void;
}

/**
 * The operator's packages, beside the typed amount.
 *
 * The fixed bonus and the campaign's bonus are their own lines rather than
 * one number, because the bonus is the reason to pick the larger package.
 * The campaign's numbers come from the store, from the function the purchase
 * uses, so a card cannot promise what the payment will not pay.
 */
export function PackageCards({ packages, campaignLive, buying, disabled, onBuy }: PackageCardsProps) {
    const t = useTranslations("store");
    const locale = useLocale();
    const numberTag = dateLocaleTag(locale);
    const { format: money } = useSiteCurrency();
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {packages.map((pack) => (
                <div key={pack.id} className="rounded-lg border border-border p-4">
                    <p className="font-medium">{pack.name}</p>
                    <p className="mt-1 text-2xl font-bold">{pack.credits.toLocaleString(numberTag)}</p>
                    {pack.bonusCredits > 0 && (
                        <p className="text-sm text-success">{t("topUp_packageBonus", { count: pack.bonusCredits })}</p>
                    )}
                    {campaignLive && (pack.campaignBonus?.credits ?? 0) > 0 && (
                        <p className="text-sm font-medium text-success">
                            {t("topUp_packageCampaign", { percent: pack.campaignBonus?.percent ?? 0, count: pack.campaignBonus?.credits ?? 0 })}
                        </p>
                    )}
                    <p className="mt-2 text-sm text-muted-foreground">{money(pack.price)}</p>
                    <Button className="mt-3 w-full" size="sm" disabled={disabled || buying !== null} onClick={() => onBuy(pack.id)}>
                        {buying === pack.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                        {t("topUp_packageBuy")}
                    </Button>
                </div>
            ))}
        </div>
    );
}
