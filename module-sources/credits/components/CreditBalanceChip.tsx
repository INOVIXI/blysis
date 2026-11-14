"use client";

import { Coins } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/core/sdk/navigation";
import { useCreditBalance } from "../lib/use-credit-balance";

/**
 * The balance in the site's bar, beside the cart and the bell.
 *
 * The balance was only on the profile's credits section, three clicks from
 * anywhere a member decides whether they can afford something. Icon and
 * number only, so it stays narrow on a phone's bar; the words are in its
 * accessible name. Nothing is drawn until the number is known, and nothing
 * when it could not be read.
 */
export function CreditBalanceChip() {
    const t = useTranslations("credits");
    const { balance, formatted } = useCreditBalance();

    if (balance === null) return null;

    return (
        <Link
            href="/profile?section=credits"
            aria-label={t("bal_ariaLabel", { amount: formatted })}
            className="flex min-w-0 items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium tabular-nums text-foreground hover:bg-muted transition-colors"
        >
            <Coins className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="max-w-[6rem] truncate">{formatted}</span>
        </Link>
    );
}

export default CreditBalanceChip;
