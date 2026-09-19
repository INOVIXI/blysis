"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, useLocalDate } from "@/core/sdk/ui";
import { Check, Coins, Copy, History, Loader2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/core/sdk";

interface ReferralData {
    referralCode: string;
    stats: {
        totalReferrals: number;
        completedReferrals: number;
        pendingReferrals: number;
        creditsEarned: number;
    };
    referrals: {
        id: string;
        username: string;
        status: string;
        rewardAmount: number;
        createdAt: string;
    }[];
}

export function ReferralTab() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const t = useTranslations("referral");
    const commonT = useTranslations("common");
    const [data, setData] = useState<ReferralData | null>(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        fetch("/api/v1/referral")
            .then(r => r.json())
            .then(d => setData(d))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const copyLink = async () => {
        if (!data) return;
        const link = `${window.location.origin}?ref=${data.referralCode}`;
        if (!(await copyText(link))) return;
        setCopied(true);
        toast.success(t("linkCopied"));
        setTimeout(() => setCopied(false), 2000);
    };

    if (loading) {
        return (
            <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!data) {
        return (
            <p className="text-center text-muted-foreground py-8">
                {t("failedToLoad")}
            </p>
        );
    }

    return (
        <div className="space-y-4">
            {/* Referral Link */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">{t("yourLink")}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-2">
                        <Input
                            readOnly
                            aria-label={t("yourLink")}
                            value={`${typeof window !== "undefined" ? window.location.origin : ""}?ref=${data.referralCode}`}
                            className="font-mono text-xs"
                        />
                        <Button aria-label={commonT("copy")} onClick={copyLink} variant="outline" size="sm">
                            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-3">
                <Card>
                    <CardContent className="p-3 text-center">
                        <Users className="w-5 h-5 text-primary mx-auto mb-1" />
                        <p className="text-lg font-bold">{data.stats.totalReferrals}</p>
                        <p className="text-xs text-muted-foreground">{t("referralCount")}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-3 text-center">
                        <Check className="w-5 h-5 text-success mx-auto mb-1" />
                        <p className="text-lg font-bold">{data.stats.completedReferrals}</p>
                        <p className="text-xs text-muted-foreground">{t("completedReferrals")}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-3 text-center">
                        <Coins className="w-5 h-5 text-success mx-auto mb-1" />
                        <p className="text-lg font-bold">{(Number(data.stats.creditsEarned) || 0).toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">{t("creditsEarned")}</p>
                    </CardContent>
                </Card>
            </div>

            {/* Recent Referrals */}
            {data.referrals.length > 0 && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">{t("referralHistory")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {data.referrals.slice(0, 5).map(ref => (
                                <div key={ref.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                                    <div>
                                        <p className="text-sm font-medium">{ref.username || t("unknownUser")}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {formatDate(ref.createdAt)}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                            ref.status === "rewarded" ? "bg-success/10 text-success" :
                                            ref.status === "completed" ? "bg-primary/10 text-primary" :
                                            "bg-warning/10 text-warning"
                                        }`}>
                                            {t.has(ref.status) ? t(ref.status) : ref.status}
                                        </span>
                                        <p className="text-xs text-muted-foreground mt-1">{(Number(ref.rewardAmount) || 0).toFixed(2)} {t("creditsUnit")}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
