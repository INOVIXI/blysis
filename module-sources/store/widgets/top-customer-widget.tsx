"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { sharedJson } from "@/core/sdk";
import { MemberLink, useSiteCurrency } from "@/core/sdk/ui";

export function TopCustomerWidget() {
    const sidebarT = useTranslations('sidebar');
    const { format: formatPrice } = useSiteCurrency();
    const [topCustomer, setTopCustomer] = useState<{ username: string; avatar: string | null; total: number } | null>(null);

    useEffect(() => {
        // Four widgets read the same payload; one request serves them all.
        sharedJson<{ topCustomer?: { username: string; avatar: string | null; total: number } }>("/api/v1/widget-stats")
            .then((data) => {
                if (data.topCustomer) setTopCustomer(data.topCustomer);
            })
            .catch(() => {});
    }, []);

    if (!topCustomer) return null;

    return (
        <div className="bg-card rounded-xl border border-border p-5">
            <h2 className="font-bold text-foreground mb-4">{sidebarT('topCustomer')}</h2>
            <div className="flex flex-col items-center text-center">
                {/* The one widget that stacks rather than lines up: the face is
                    the point of it. `MemberLink` lays out in a row, so the
                    column is made here and the link still wraps both. */}
                <MemberLink
                    username={topCustomer.username}
                    avatar={topCustomer.avatar}
                    size={64}
                    className="flex-col gap-2"
                    nameClassName="text-center font-semibold"
                />
                <p className="mt-1 text-sm text-muted-foreground">
                    {sidebarT('paidThisMonth', { amount: formatPrice(topCustomer.total) })}
                </p>
            </div>
        </div>
    );
}
