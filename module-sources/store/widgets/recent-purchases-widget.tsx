"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { sharedJson } from "@/core/sdk";
import { MemberLink, useRelativeTime } from "@/core/sdk/ui";

interface RecentPurchase {
    username: string;
    avatar: string | null;
    product: string;
    time: string;
}

export function RecentPurchasesWidget() {
    const sidebarT = useTranslations('sidebar');
    const relativeTime = useRelativeTime();
    const [purchases, setPurchases] = useState<RecentPurchase[]>([]);

    useEffect(() => {
        // Four widgets read the same payload; one request serves them all.
        sharedJson<{ recentPurchases?: RecentPurchase[] }>("/api/v1/widget-stats")
            .then((data) => setPurchases(data.recentPurchases || []))
            .catch(() => {});
    }, []);

    if (purchases.length === 0) return null;

    return (
        <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-foreground">{sidebarT('recentPurchases')}</h2>
                <span className="text-xs text-success font-medium">● {sidebarT('live')}</span>
            </div>
            <div className="space-y-3">
                {purchases.map((purchase, i) => (
                    <div key={i} className="flex items-center gap-3">
                        <MemberLink
                            username={purchase.username}
                            avatar={purchase.avatar}
                            subtitle={purchase.product}
                            className="flex-1"
                            nameClassName="text-sm"
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {relativeTime(new Date(purchase.time))}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
