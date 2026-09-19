"use client";

import { useState, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button, Card, CardContent, CardHeader, CardTitle, LoadFailed, usePrompt, useLocalDate } from "@/core/sdk/ui";
import { errorMessage } from "@/core/sdk";
import { Gift, Package, Loader2 } from "lucide-react";

interface ChestItem {
    id: string;
    productName: string;
    quantity: number;
    createdAt: string;
    /**
     * Whether this one may be handed to somebody else.
     *
     * The server's answer, not the screen's: gifting is a site switch and a
     * product switch, and this row has already been through both. The button
     * used to be drawn on everything and the refusal arrived after the click.
     */
    canGift: boolean;
}

export function ProfileChestTab() {
    const __locale = useLocale();
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const ask = usePrompt();
    const [chestItems, setChestItems] = useState<ChestItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/chest")
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then(data => { if (cancelled) return; setChestItems(data.items || []); setFailed(false); })
            .catch(() => { if (cancelled) return; setFailed(true); })
            .finally(() => { if (cancelled) return; setLoading(false); });
        return () => { cancelled = true; };
    }, [reloadKey]);

    const claim = async (id: string, body: Record<string, string>) => {
        const res = await fetch(`/api/v1/chest/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (res.ok) return { ok: true as const };
        return { ok: false as const, body: await res.json().catch(() => null) };
    };

    /**
     * Claiming asks for a name only when the item has none.
     *
     * Everything bought through checkout carries the name the buyer gave, so
     * the common claim is one click. An item an operator put in a chest by
     * hand was never bought and has nobody recorded, and that is the only
     * case worth a dialog.
     */
    const redeem = async (id: string) => {
        try {
            let answer = await claim(id, {});
            if (!answer.ok && answer.body?.code === "chest_needs_player_name") {
                const playerName = await ask({
                    title: t("tab_chest_whoTitle"),
                    message: t("tab_chest_whoMessage"),
                    placeholder: t("playerNamePlaceholder"),
                    confirmText: t("tab_chest_redeem"),
                    required: true,
                });
                if (!playerName) return;
                answer = await claim(id, { playerName });
            }
            if (!answer.ok) {
                toast.error(errorMessage(answer.body, t("tab_chest_redeemError"), t));
                return;
            }
            setChestItems(prev => prev.filter((c) => c.id !== id));
        } catch {
            toast.error(commonT("somethingWentWrong"));
        }
    };

    /**
     * Giving an item away. The endpoint has always taken a recipient and no
     * screen ever offered one, so the feature existed only for whoever read
     * the source.
     */
    const gift = async (id: string, productName: string) => {
        const giftTo = await ask({
            title: t("tab_chest_giftTitle"),
            message: t("tab_chest_giftMessage", { name: productName }),
            placeholder: t("tab_chest_giftPlaceholder"),
            confirmText: t("tab_chest_gift"),
            required: true,
        });
        if (!giftTo) return;
        try {
            const answer = await claim(id, { giftTo });
            if (!answer.ok) {
                toast.error(errorMessage(answer.body, t("tab_chest_giftError"), t));
                return;
            }
            setChestItems(prev => prev.filter((c) => c.id !== id));
            toast.success(t("tab_chest_gifted", { name: giftTo }));
        } catch {
            toast.error(commonT("somethingWentWrong"));
        }
    };

    if (loading) {
        return (
            <Card>
                <CardContent className="p-8 text-center">
                    {/* The site's spinner. This was a div with a spinning border
                        whose top edge was a hardcoded grey, so on a dark theme it
                        span a light ring against a dark one. */}
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader><CardTitle>{t("tab_chest_title")}</CardTitle></CardHeader>
            <CardContent>
                {failed ? (
                    <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
                ) : chestItems.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">{t("tab_chest_empty")}</p>
                ) : (
                    <div className="space-y-3">
                        {chestItems.map((item) => (
                            <div key={item.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                                <div>
                                    <p className="font-medium">{item.productName}</p>
                                    <p className="text-xs text-muted-foreground">{t("tab_chest_qty")}: {item.quantity} · {formatDate(item.createdAt)}</p>
                                </div>
                                <div className="flex gap-2">
                                    {item.canGift && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            aria-label={`${t("tab_chest_gift")}: ${item.productName}`}
                                            onClick={() => gift(item.id, item.productName)}
                                        >
                                            <Gift className="w-4 h-4" aria-hidden="true" />
                                        </Button>
                                    )}
                                    <Button size="sm" onClick={() => redeem(item.id)}>{t("tab_chest_redeem")}</Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export default ProfileChestTab;
