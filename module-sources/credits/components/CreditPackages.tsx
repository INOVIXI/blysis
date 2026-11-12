"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button, Card, CardContent, CardHeader, CardTitle, useSiteCurrency } from "@/core/sdk/ui";
import { dateLocaleTag, errorMessage } from "@/core/sdk";
import { Gift, Loader2 } from "lucide-react";

interface CreditPackage {
    id: string;
    name: string;
    credits: number;
    bonusCredits: number;
    price: number;
    /** What a running bonus campaign adds, worked out by the store. */
    campaignBonus?: { percent: number; credits: number } | null;
}

interface BonusCampaign {
    id: string;
    /** An instant, so the countdown runs on the reader's clock. */
    endsAt: string;
    tiers: { minAmount: number; percent: number }[];
}

/** Whole days, hours and minutes until an instant, never below zero. */
function timeLeft(endsAt: string, now: number) {
    const minutes = Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 60_000));
    return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60 };
}

/**
 * The packages a member can buy.
 *
 * The bonus is shown as its own line rather than folded into one number,
 * because it is the whole reason to pick the larger package. A shop that has
 * defined none draws nothing here and keeps whatever it had.
 *
 * While a bonus campaign runs, its tiers and its end are shown above the
 * packages, and each package says what the campaign adds to it. The numbers
 * come from the store, from the same function that decides the bonus when a
 * payment starts, so the screen cannot promise a different number.
 */
export function CreditPackages({ onBought }: { onBought: () => void }) {
    const t = useTranslations("credits");
    const commonT = useTranslations("common");
    // The reader's locale, not the renderer's: a thousand is 1,000 or 1.000
    // depending on who is looking at it.
    const locale = useLocale();
    const numberTag = dateLocaleTag(locale);
    const { format: money } = useSiteCurrency();
    const [packages, setPackages] = useState<CreditPackage[]>([]);
    const [buying, setBuying] = useState<string | null>(null);
    const [campaigns, setCampaigns] = useState<BonusCampaign[]>([]);
    const [now, setNow] = useState(() => Date.now());

    // A countdown that moves. Once a minute is as fine as it is drawn.
    useEffect(() => {
        if (campaigns.length === 0) return;
        const timer = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, [campaigns.length]);

    useEffect(() => {
        let cancelled = false;
        // Named in the reader's language, and the shop's original where it
        // wrote none.
        fetch(`/api/v1/store/credit-packages?locale=${encodeURIComponent(locale)}`)
            .then((res) => (res.ok ? res.json() : { packages: [] }))
            .then((data) => {
                if (cancelled) return;
                setPackages(Array.isArray(data.packages) ? data.packages : []);
                setCampaigns(Array.isArray(data.bonusCampaigns) ? data.bonusCampaigns : []);
            })
            .catch(() => { if (!cancelled) setPackages([]); });
        return () => { cancelled = true; };
    }, [locale]);

    if (packages.length === 0) return null;

    // A campaign that ended while the page was open is no longer offered: the
    // purchase would not get it, so the screen stops promising it.
    const live = campaigns.filter((campaign) => new Date(campaign.endsAt).getTime() > now);
    const liveBonus = (pack: CreditPackage) => live.length > 0 && (pack.campaignBonus?.credits ?? 0) > 0;

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
                {live.map((campaign) => {
                    const left = timeLeft(campaign.endsAt, now);
                    return (
                        <div key={campaign.id} className="mb-4 rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
                            <p className="flex items-center gap-2 font-medium text-success">
                                <Gift className="h-4 w-4" aria-hidden="true" />
                                {t("buy_campaignTitle")}
                            </p>
                            <ul className="mt-1 space-y-0.5">
                                {campaign.tiers.map((tier) => (
                                    <li key={tier.minAmount}>{t("buy_campaignTier", { amount: money(tier.minAmount), percent: tier.percent })}</li>
                                ))}
                            </ul>
                            <p className="mt-1 text-muted-foreground">
                                {left.days > 0
                                    ? t("buy_campaignEnds", { days: left.days, hours: left.hours })
                                    : t("buy_campaignEndsSoon", { hours: left.hours, minutes: left.minutes })}
                            </p>
                        </div>
                    );
                })}
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
                            {liveBonus(pack) && (
                                <p className="text-sm font-medium text-success">
                                    {t("buy_campaignBonus", { percent: pack.campaignBonus?.percent ?? 0, count: pack.campaignBonus?.credits ?? 0 })}
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
