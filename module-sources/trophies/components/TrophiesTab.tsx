"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/core/sdk/navigation";
import { Card, CardContent, CardHeader, CardTitle, LoadFailed, useLocalDate } from "@/core/sdk/ui";
import { Award, Loader2 } from "lucide-react";

interface EarnedTrophy {
    id: string;
    awardedAt: string;
    trophy: {
        id: string;
        name: string;
        description: string | null;
        icon: string | null;
        color: string | null;
        points: number;
    };
}

export default function TrophiesTab() {
    const t = useTranslations("trophies");
    const __locale = useLocale();
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const [earned, setEarned] = useState<EarnedTrophy[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/me/trophies")
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then(d => { if (cancelled) return;
                setEarned(Array.isArray(d.earned) ? d.earned : []);
                setTotal(Number(d.total) || 0);
                setFailed(false);
            })
            .catch(() => { if (cancelled) return; setFailed(true); })
            .finally(() => { if (cancelled) return; setLoading(false); });
        return () => { cancelled = true; };
    }, [reloadKey]);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Award className="w-5 h-5 text-warning" />
                    {t("title")}
                    <span className="text-sm font-normal text-muted-foreground ml-2">
                        {t("earnedCount", { earned: earned.length, total })}
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex justify-center py-6">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                ) : failed ? (
                    <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
                ) : earned.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                        {t("noneYet")}{" "}
                        <Link href="/trophies" className="text-primary hover:underline">
                            {t("browseAll")}
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {earned.map((et) => (
                            <div
                                key={et.id}
                                className="flex items-center gap-2 p-2 rounded-md border border-border"
                                title={et.trophy.description || et.trophy.name}
                            >
                                <div
                                    className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0"
                                    style={{ backgroundColor: et.trophy.color || "#6366f1" }}
                                >
                                    <Award className="w-5 h-5" />
                                </div>
                                <div className="min-w-0">
                                    <div className="font-medium text-xs truncate">{et.trophy.name}</div>
                                    <div className="text-[10px] text-muted-foreground">
                                        {formatDate(et.awardedAt)}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
