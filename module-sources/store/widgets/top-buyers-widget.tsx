"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { sharedJson } from "@/core/sdk";
import { MemberLink, useSiteCurrency } from "@/core/sdk/ui";

interface TopBuyer {
    username: string;
    avatar: string | null;
    total: number;
}

export function TopBuyersWidget() {
    const sidebarT = useTranslations('sidebar');
    const { format: formatPrice } = useSiteCurrency();
    const [buyers, setBuyers] = useState<TopBuyer[]>([]);

    useEffect(() => {
        // Four widgets read the same payload; one request serves them all.
        sharedJson<{ topBuyers?: TopBuyer[] }>("/api/v1/widget-stats")
            .then((data) => setBuyers(data.topBuyers || []))
            .catch(() => {});
    }, []);

    if (buyers.length === 0) return null;

    return (
        <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-foreground">{sidebarT('topBuyers')}</h2>
                <span className="text-xs text-muted-foreground uppercase">{sidebarT('thisWeek')}</span>
            </div>
            <div className="space-y-3">
                {buyers.map((buyer, i) => (
                    <div key={i} className="flex items-center gap-3">
                        <MemberLink
                            username={buyer.username}
                            avatar={buyer.avatar}
                            size={40}
                            className="flex-1"
                            nameClassName="text-sm"
                        />
                        <span className="text-sm text-muted-foreground">{formatPrice(buyer.total)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
