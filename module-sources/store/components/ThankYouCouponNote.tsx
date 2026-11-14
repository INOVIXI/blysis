"use client";

import { useTranslations } from "next-intl";
import { Badge, useLocalDate } from "@/core/sdk/ui";
import { Gift } from "lucide-react";
import { STANDING_TONE, type CouponStanding } from "../lib/coupon-standing";

/**
 * What the buyer is told about where their coupon stands. A thank-you coupon
 * never has a start date, so "not started" cannot happen and reads as ready.
 * Its own words rather than the coupon list's: those are the admin's, and a
 * member's page is not sent them.
 */
const STANDING_KEY: Record<CouponStanding, string> = {
    live: "tab_orders_thanksLive",
    scheduled: "tab_orders_thanksLive",
    usedUp: "tab_orders_thanksUsed",
    expired: "tab_orders_thanksExpired",
    off: "tab_orders_thanksWithdrawn",
};

/** A thank-you coupon as the orders endpoint sends it. */
export interface ThankYouCouponJson {
    code: string;
    percent: number;
    expiresAt: string | null;
    standing: CouponStanding;
}

interface ThankYouCouponNoteProps {
    coupon: ThankYouCouponJson;
}

/**
 * The coupon a paid order earned, on the screens its buyer opens.
 *
 * The email carries it too, but an email is the one place a buyer cannot be
 * counted on to look twice, so the order says it as well. A coupon that has
 * stopped working keeps its row with the reason beside it, rather than
 * disappearing and leaving the buyer to wonder whether it was ever there.
 */
export function ThankYouCouponNote({ coupon }: ThankYouCouponNoteProps) {
    const t = useTranslations("store");
    const formatDate = useLocalDate();
    const date = coupon.expiresAt ? formatDate(coupon.expiresAt) : "";
    return (
        <div className="mt-3 p-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 text-sm">
            <div className="flex items-center justify-between gap-2">
                <p className="font-medium flex items-center gap-2">
                    <Gift className="w-4 h-4 text-primary" aria-hidden="true" />
                    {t("tab_orders_thanksTitle")}
                </p>
                <Badge tone={STANDING_TONE[coupon.standing]}>{t(STANDING_KEY[coupon.standing])}</Badge>
            </div>
            <p className="text-muted-foreground mt-1">{t("tab_orders_thanksBody", { percent: coupon.percent, date })}</p>
            <p className="mt-2 font-mono text-base tracking-widest select-all text-foreground">{coupon.code}</p>
        </div>
    );
}
