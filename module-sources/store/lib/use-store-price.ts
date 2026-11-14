"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { dateLocaleTag, sharedJson, peekShared } from "@/core/sdk";
import { useSiteCurrency } from "@/core/sdk/ui";
import type { TopUpLimits } from "./credit-top-up-quote";

const OPTIONS_URL = "/api/v1/store/credits/options";

/** What `GET /store/credits/options` answers. */
export interface CreditOptions {
    topUp: TopUpLimits & { cents: boolean };
    creditsOnly: boolean;
    bonusCampaigns: { id: string; endsAt: string; tiers: { minAmount: number; percent: number }[] }[];
}

/**
 * How this shop sells credits, read once per page however many prices ask.
 * `options` is null until it arrives; `failed` says it never will, so a
 * screen built on it can say so instead of waiting.
 */
export function useCreditOptions(reloadKey = 0): { options: CreditOptions | null; failed: boolean } {
    const [options, setOptions] = useState<CreditOptions | null>(() => peekShared<CreditOptions>(OPTIONS_URL) ?? null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setFailed(false);
        sharedJson<CreditOptions>(OPTIONS_URL)
            .then((data) => { if (!cancelled) setOptions(data); })
            .catch(() => { if (!cancelled) setFailed(true); });
        return () => { cancelled = true; };
    }, [reloadKey]);
    return { options, failed };
}

/**
 * A store price as the buyer should read it.
 *
 * In money, as `useSiteCurrency` writes it, unless the store takes only
 * credits: then a price is the credits the checkout will take from the
 * balance, which is the same number, since an order paid from the balance
 * takes one credit per unit of its total. Buyer-facing screens use this; the
 * admin screens keep money, because the operator types prices in money and
 * reads revenue in it.
 */
export function useStorePrice(): { format: (amount: number | string | null | undefined) => string; creditsOnly: boolean } {
    const t = useTranslations("store");
    const locale = useLocale();
    const { format: money } = useSiteCurrency();
    // Unread, a price is written in money: the checkout still refuses a
    // gateway on its own, so a wrong label is the worst that can happen.
    const { options } = useCreditOptions();
    const creditsOnly = options?.creditsOnly === true;
    return useMemo(() => {
        if (!creditsOnly) return { format: money, creditsOnly };
        const number = new Intl.NumberFormat(dateLocaleTag(locale), { maximumFractionDigits: 2 });
        return {
            creditsOnly,
            format: (amount: number | string | null | undefined) => t("price_credits", { amount: number.format(Number(amount) || 0) }),
        };
    }, [creditsOnly, locale, money, t]);
}
