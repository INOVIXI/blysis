"use client";

import { Coins } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/core/sdk/navigation";
import { useCreditBalance } from "../lib/use-credit-balance";

interface UserMenuBalanceProps {
    /** Closes the account menu; core hands it to whatever fills `navbar.userMenu`. */
    close?: () => void;
}

/**
 * The balance inside the account menu, under the profile link: the place a
 * member looks for what belongs to their account.
 */
export default function UserMenuBalance({ close }: UserMenuBalanceProps) {
    const t = useTranslations("credits");
    const { balance, formatted } = useCreditBalance();

    if (balance === null) return null;

    return (
        <Link
            href="/profile?section=credits"
            onClick={() => close?.()}
            className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
            <Coins className="h-4 w-4" aria-hidden="true" />
            <span className="truncate tabular-nums">{t("bal_menu", { amount: formatted })}</span>
        </Link>
    );
}
