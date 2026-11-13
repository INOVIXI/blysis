"use client";

import { Coins } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/core/sdk/navigation";
import { useCreditBalance } from "../lib/use-credit-balance";

/**
 * The balance at the top of the shop, where a member is deciding what to buy
 * with it. A visitor has no balance, so they see nothing; neither does a
 * member whose balance could not be read.
 */
export default function StoreBalanceStrip() {
    const t = useTranslations("credits");
    const { balance, formatted } = useCreditBalance();

    if (balance === null) return null;

    return (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Coins className="h-4 w-4" aria-hidden="true" />
            </span>
            <Link href="/profile?section=credits" className="text-sm font-medium tabular-nums text-foreground hover:text-primary">
                {t("bal_store", { amount: formatted })}
            </Link>
        </div>
    );
}
