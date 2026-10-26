"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, LoadFailed } from "@/core/sdk/ui";
import { Loader2, Users, UserPlus, Coins, Clock, Save } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/core/sdk/admin";

interface AdminStats {
    totalReferrals: number;
    completedReferrals: number;
    pendingReferrals: number;
    totalRewards: number;
    topReferrers: {
        username: string;
        avatar: string | null;
        referralCount: number;
        totalReward: number;
    }[];
    rewardAmount: number;
}

export default function AdminReferralPage() {
    const t = useTranslations("referral");
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [rewardAmount, setRewardAmount] = useState("");
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/referral/stats")
            .then(r => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then(d => { if (cancelled) return;
                setStats(d);
                setRewardAmount(String(d.rewardAmount));
                setFailed(false);
            })
            .catch(() => { if (cancelled) return; setFailed(true); })
            .finally(() => { if (cancelled) return; setLoading(false); });
        return () => { cancelled = true; };
    }, [reloadKey]);

    const saveSettings = async () => {
        const amount = parseFloat(rewardAmount);
        if (isNaN(amount) || amount < 0) {
            toast.error(t("adm_invalidReward"));
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/v1/referral/stats", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rewardAmount: amount }),
            });
            if (res.ok) {
                toast.success(t("settingsSaved"));
            } else {
                toast.error(t("settingsError"));
            }
        } catch {
            toast.error(t("settingsError"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!stats) {
        return (
            <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                    {t("adm_failedToLoad")}
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <AdminPageHeader
                title={t("adm_referralManagement")}
                description={t("adm_referralOverview")}
            />

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 rounded-lg">
                                <Users className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{stats.totalReferrals}</p>
                                <p className="text-xs text-muted-foreground">{t("adm_totalReferrals")}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-success/10 rounded-lg">
                                <UserPlus className="w-5 h-5 text-success" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{stats.completedReferrals}</p>
                                <p className="text-xs text-muted-foreground">{t("adm_completed")}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-warning/10 rounded-lg">
                                <Clock className="w-5 h-5 text-warning" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{stats.pendingReferrals}</p>
                                <p className="text-xs text-muted-foreground">{t("adm_pending")}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-success/10 rounded-lg">
                                <Coins className="w-5 h-5 text-success" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{(Number(stats.totalRewards) || 0).toFixed(2)}</p>
                                <p className="text-xs text-muted-foreground">{t("adm_totalRewards")}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Top Referrers */}
                <Card>
                    <CardHeader>
                        <CardTitle>{t("adm_topReferrers")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {failed ? (
                            <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
                        ) : stats.topReferrers.length === 0 ? (
                            <p className="text-center text-muted-foreground py-4">{t("adm_noReferrals")}</p>
                        ) : (
                            <div className="space-y-3">
                                {stats.topReferrers.map((referrer, index) => (
                                    <div key={index} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                                        <span className="text-sm font-bold text-muted-foreground w-6">#{index + 1}</span>
                                        <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center flex-shrink-0">
                                            {referrer.avatar ? (
                                                <img src={referrer.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                                            ) : (
                                                <UserPlus className="w-4 h-4 text-muted-foreground" />
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium">{referrer.username}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {referrer.referralCount} referrals -- {(Number(referrer.totalReward) || 0).toFixed(2)} credits
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Settings */}
                <Card>
                    <CardHeader>
                        <CardTitle>{t("adm_settings")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t("adm_rewardPerReferral")}</label>
                            <Input
                                aria-label={t("adm_rewardPerReferral")}
                                type="number"
                                min="0"
                                step="0.01"
                                value={rewardAmount}
                                onChange={e => setRewardAmount(e.target.value)}
                                placeholder="5.00"
                            />
                            <p className="text-xs text-muted-foreground">
                                {t("adm_rewardDescription")}
                            </p>
                        </div>
                        <Button onClick={saveSettings} disabled={saving}>
                            {saving ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Save className="w-4 h-4" />
                            )}
                            {t("adm_saveSettings")}
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
