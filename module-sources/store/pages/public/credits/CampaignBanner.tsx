"use client";

import { useTranslations } from "next-intl";
import { useSiteCurrency } from "@/core/sdk/ui";
import { Gift } from "lucide-react";
import type { CreditOptions } from "../../../lib/use-store-price";

/** Whole days, hours and minutes until an instant, never below zero. */
function timeLeft(endsAt: string, now: number) {
    const minutes = Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 60_000));
    return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60 };
}

interface CampaignBannerProps {
    campaigns: CreditOptions["bonusCampaigns"];
    now: number;
}

/**
 * The running bonus campaigns: every tier, and how long is left.
 *
 * The tiers are money, because the tier is chosen by what is paid. The
 * countdown is drawn on the reader's clock from the end as an instant, so a
 * response a cache kept for a minute does not show a minute too much.
 */
export function CampaignBanner({ campaigns, now }: CampaignBannerProps) {
    const t = useTranslations("store");
    const { format: money } = useSiteCurrency();
    return (
        <>
            {campaigns.map((campaign) => {
                const left = timeLeft(campaign.endsAt, now);
                return (
                    <div key={campaign.id} className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
                        <p className="flex items-center gap-2 font-medium text-success">
                            <Gift className="h-4 w-4" aria-hidden="true" />
                            {t("topUp_campaignTitle")}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                            {campaign.tiers.map((tier) => (
                                <li key={tier.minAmount}>{t("topUp_campaignTier", { amount: money(tier.minAmount), percent: tier.percent })}</li>
                            ))}
                        </ul>
                        <p className="mt-1 text-muted-foreground">
                            {left.days > 0
                                ? t("topUp_campaignEnds", { days: left.days, hours: left.hours })
                                : t("topUp_campaignEndsSoon", { hours: left.hours, minutes: left.minutes })}
                        </p>
                    </div>
                );
            })}
        </>
    );
}
