"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, useConfirm } from "@/core/sdk/ui";
import { errorMessage } from "@/core/sdk";
import { Loader2, Send } from "lucide-react";

/**
 * Sending credits to another member.
 *
 * Confirmed before it goes, because it cannot be taken back: there is no
 * screen anywhere that moves credits the other way, and the recipient is
 * whoever the sender typed. A confirmation that repeats the name and the
 * amount is the last chance to notice a typo in either.
 */
export function SendCredits({ balance, onSent }: { balance: number; onSent: () => void }) {
    const t = useTranslations("credits");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();
    const [to, setTo] = useState("");
    const [amount, setAmount] = useState("");
    const [sending, setSending] = useState(false);

    const send = async (event: React.FormEvent) => {
        event.preventDefault();
        const count = Number(amount);
        if (!to.trim() || !Number.isInteger(count) || count <= 0) {
            toast.error(t("send_fillItIn"));
            return;
        }

        const sure = await confirm({
            title: t("send_confirmTitle"),
            message: t("send_confirmMessage", { amount: count, name: to.trim() }),
            confirmText: t("send_send"),
        });
        if (!sure) return;

        setSending(true);
        try {
            const res = await fetch("/api/v1/store/credits/transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ to: to.trim(), amount: count }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                toast.error(errorMessage(data, t("send_failed"), t));
                return;
            }
            toast.success(t("send_sent", { amount: count, name: data?.to ?? to.trim() }));
            setTo("");
            setAmount("");
            onSent();
        } catch {
            toast.error(commonT("somethingWentWrong"));
        } finally {
            setSending(false);
        }
    };

    return (
        <Card>
            <CardHeader><CardTitle>{t("send_title")}</CardTitle></CardHeader>
            <CardContent>
                <form onSubmit={send} className="space-y-4">
                    <p className="text-sm text-muted-foreground">{t("send_hint", { balance })}</p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <Label htmlFor="creditsTo">{t("send_to")}</Label>
                            <Input
                                id="creditsTo"
                                value={to}
                                onChange={(e) => setTo(e.target.value)}
                                placeholder={t("send_toPlaceholder")}
                                autoComplete="off"
                                required
                            />
                        </div>
                        <div>
                            <Label htmlFor="creditsAmount">{t("send_amount")}</Label>
                            <Input
                                id="creditsAmount"
                                type="number"
                                min={1}
                                step="1"
                                max={balance}
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                required
                            />
                        </div>
                    </div>
                    <Button type="submit" disabled={sending || balance <= 0}>
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                        {t("send_send")}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}
