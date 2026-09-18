"use client";

import { useState, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, LoadFailed, Pagination, usePagedRows, useLocalDate } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { Loader2, UserPlus, Users, Coins, Clock, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/core/sdk";
import { errorMessage } from "@/core/sdk";

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
        image: string | null;
        status: string;
        rewardAmount: number;
        createdAt: string;
    }[];
}

export default function ReferralPage() {
    const __locale = useLocale();
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const t = useTranslations("referral");
    const { data: session } = useSession();
    const [data, setData] = useState<ReferralData | null>(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    const [referralCodeInput, setReferralCodeInput] = useState("");
    const [applying, setApplying] = useState(false);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const paged = usePagedRows(data?.referrals ?? [], 10);

    useEffect(() => {
        let cancelled = false;
        if (!session?.user) {
            setLoading(false);
            return;
        }
        fetch("/api/v1/referral")
            .then(r => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then(d => {
                if (cancelled) return;
                setData(d);
                setFailed(false);
            })
            .catch(() => { if (!cancelled) setFailed(true); })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [session, reloadKey]);

    const copyLink = async () => {
        if (!data) return;
        const link = `${typeof window !== "undefined" ? window.location.origin : ""}?ref=${data.referralCode}`;
        if (!(await copyText(link))) {
            toast.error(t("copyFailed"));
            return;
        }
        setCopied(true);
        toast.success(t("linkCopied"));
        setTimeout(() => setCopied(false), 2000);
    };

    const applyCode = async () => {
        if (!referralCodeInput.trim()) return;
        setApplying(true);
        try {
            const res = await fetch("/api/v1/referral", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ referralCode: referralCodeInput.trim() }),
            });
            const result = await res.json();
            if (res.ok) {
                toast.success(t("codeApplied"));
                setReferralCodeInput("");
            } else {
                toast.error(errorMessage(result, t("codeError"), t));
            }
        } catch {
            toast.error(t("somethingWrong"));
        } finally {
            setApplying(false);
        }
    };

    const statusBadge = (status: string) => {
        switch (status) {
            case "rewarded": return "bg-success/10 text-success";
            case "completed": return "bg-primary/10 text-primary";
            default: return "bg-warning/10 text-warning";
        }
    };

    const statusLabel = (status: string) => {
        if (status === "rewarded") return t("rewarded");
        if (status === "completed") return t("completed");
        return t("pending");
    };

    return (
        <PageFrame
            title={t("title")}
            description={t("subtitle")}
        >
            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            ) : !session?.user ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <UserPlus className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground">{t("notLoggedIn")}</p>
                    </CardContent>
                </Card>
            ) : !data ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        {t("failedToLoad")}
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-6">
                    {/* Referral Link */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("yourLink")}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground mb-3">
                                {t("shareMessage")}
                            </p>
                            <div className="flex gap-2">
                                <Input
                                    readOnly
                                    aria-label={t("yourLink")}
                                    value={`${typeof window !== "undefined" ? window.location.origin : ""}?ref=${data.referralCode}`}
                                    className="font-mono text-sm"
                                />
                                <Button onClick={copyLink} variant="outline">
                                    {copied ? (
                                        <><Check className="w-4 h-4" /> {t("copied")}</>
                                    ) : (
                                        <><Copy className="w-4 h-4" /> {t("copyLink")}</>
                                    )}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                                {t("yourCode")}: <span className="font-mono font-bold">{data.referralCode}</span>
                            </p>
                        </CardContent>
                    </Card>

                    {/* Apply Referral Code */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("haveCode")}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex gap-2">
                                <Input
                                    placeholder={t("codePlaceholder")} aria-label={t("codePlaceholder")}
                                    value={referralCodeInput}
                                    onChange={e => setReferralCodeInput(e.target.value)}
                                    onKeyDown={e => e.key === "Enter" && applyCode()}
                                />
                                <Button onClick={applyCode} disabled={applying || !referralCodeInput.trim()}>
                                    {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : t("applyCode")}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card>
                            <CardContent className="p-4 text-center">
                                <Users className="w-6 h-6 text-primary mx-auto mb-2" />
                                <p className="text-2xl font-bold">{data?.stats?.totalReferrals ?? 0}</p>
                                <p className="text-xs text-muted-foreground">{t("totalReferrals")}</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4 text-center">
                                <Check className="w-6 h-6 text-success mx-auto mb-2" />
                                <p className="text-2xl font-bold">{data?.stats?.completedReferrals ?? 0}</p>
                                <p className="text-xs text-muted-foreground">{t("completedReferrals")}</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4 text-center">
                                <Clock className="w-6 h-6 text-warning mx-auto mb-2" />
                                <p className="text-2xl font-bold">{data?.stats?.pendingReferrals ?? 0}</p>
                                <p className="text-xs text-muted-foreground">{t("pendingReferrals")}</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4 text-center">
                                <Coins className="w-6 h-6 text-success mx-auto mb-2" />
                                <p className="text-2xl font-bold">{(data?.stats?.creditsEarned ?? 0).toFixed(2)}</p>
                                <p className="text-xs text-muted-foreground">{t("creditsEarned")}</p>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Referral History */}
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("referralHistory")}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {failed ? (
                                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
                            ) : data.referrals.length === 0 ? (
                                <p className="text-center text-muted-foreground py-8">
                                    {t("noReferrals")}
                                </p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-border">
                                                <th className="text-left py-3 px-2 font-medium text-muted-foreground">{t("user")}</th>
                                                <th className="text-left py-3 px-2 font-medium text-muted-foreground">{t("status")}</th>
                                                <th className="text-left py-3 px-2 font-medium text-muted-foreground">{t("reward")}</th>
                                                <th className="text-left py-3 px-2 font-medium text-muted-foreground">{t("date")}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {paged.rows.map(ref => (
                                                <tr key={ref.id} className="border-b border-border last:border-0">
                                                    <td className="py-3 px-2 font-medium">{ref.username || t("unknownUser")}</td>
                                                    <td className="py-3 px-2">
                                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(ref.status)}`}>
                                                            {statusLabel(ref.status)}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-2">{ref.rewardAmount.toFixed(2)} {t("creditsUnit")}</td>
                                                    <td className="py-3 px-2 text-muted-foreground">
                                                        {formatDate(ref.createdAt)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {paged.pages > 1 && (
                                        <Pagination className="mt-4" page={paged.page} pages={paged.pages} total={paged.total} onPageChange={paged.setPage} />
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}
        </PageFrame>
    );
}
