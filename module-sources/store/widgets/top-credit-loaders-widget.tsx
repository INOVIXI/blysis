"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { sharedJson } from "@/core/sdk";
import { MemberLink, useSiteCurrency } from "@/core/sdk/ui";

interface TopLoader {
    username: string;
    avatar: string | null;
    total: number;
}

export function TopCreditLoadersWidget() {
    const sidebarT = useTranslations('sidebar');
    const { format: formatPrice } = useSiteCurrency();
    const [loaders, setLoaders] = useState<TopLoader[]>([]);

    useEffect(() => {
        // Four widgets read the same payload; one request serves them all.
        sharedJson<{ topCreditLoaders?: TopLoader[] }>("/api/v1/widget-stats")
            .then((data) => setLoaders(data.topCreditLoaders || []))
            .catch(() => {});
    }, []);

    if (loaders.length === 0) return null;

    return (
        <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-foreground">{sidebarT('topCreditLoaders')}</h2>
                <span className="text-xs text-muted-foreground uppercase">{sidebarT('allTime')}</span>
            </div>
            <div className="space-y-3">
                {loaders.map((loader, i) => (
                    <div key={i} className="flex items-center gap-3">
                        <MemberLink
                            username={loader.username}
                            avatar={loader.avatar}
                            size={40}
                            className="flex-1"
                            nameClassName="text-sm"
                        />
                        <span className="text-sm text-muted-foreground">{formatPrice(loader.total)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
