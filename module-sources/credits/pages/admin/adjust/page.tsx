"use client";

/**
 * Adding credits to a member's balance or taking them off, by hand.
 *
 * A reason is required and the member reads it in their credit history. The
 * change is confirmed before it is made, because a removal cannot be undone
 * except by another change. The rules are `lib/adjust.ts`.
 */
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { errorMessage } from "@/core/sdk";
import { Button, Card, CardContent, CheckboxField, Input, Label, RadioField, Textarea, useConfirm } from "@/core/sdk/ui";
import { AdminPageHeader, UserPicker, type PickedUser } from "@/core/sdk/admin";
import { useRouter } from "@/core/sdk/navigation";

export default function AdjustCreditsPage() {
    const t = useTranslations("credits");
    const commonT = useTranslations("common");
    const router = useRouter();
    const { confirm } = useConfirm();
    const [member, setMember] = useState<PickedUser | null>(null);
    const [balance, setBalance] = useState<number | null>(null);
    const [direction, setDirection] = useState<"add" | "remove">("add");
    const [amount, setAmount] = useState("");
    const [reason, setReason] = useState("");
    const [allowNegative, setAllowNegative] = useState(false);
    const [saving, setSaving] = useState(false);

    // The balance before the change, so the operator sees what they are
    // taking from. Read from the ledger endpoint, narrowed to the member.
    useEffect(() => {
        if (!member) return;
        let current = true;
        fetch(`/api/v1/credits/admin/ledger?userId=${encodeURIComponent(member.id)}&limit=1`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data: { balance?: number | null } | null) => { if (current) setBalance(data?.balance ?? null); })
            .catch(() => { if (current) setBalance(null); });
        return () => { current = false; };
    }, [member]);

    const whole = Number.parseInt(amount, 10);
    const ready = member !== null && Number.isInteger(whole) && whole > 0 && reason.trim() !== "";

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!member || !ready) {
            toast.error(t("adj_fillItIn"));
            return;
        }
        const signed = direction === "add" ? whole : -whole;
        const ok = await confirm({
            title: direction === "add" ? t("adj_confirmAddTitle") : t("adj_confirmRemoveTitle"),
            message: t(direction === "add" ? "adj_confirmAdd" : "adj_confirmRemove", { amount: whole, name: member.username }),
            confirmText: direction === "add" ? t("adj_add") : t("adj_remove"),
            variant: direction === "add" ? "default" : "danger",
        });
        if (!ok) return;

        setSaving(true);
        try {
            const res = await fetch("/api/v1/credits/admin/adjust", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: member.id,
                    amount: signed,
                    reason: reason.trim(),
                    allowNegative: direction === "remove" && allowNegative,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(errorMessage(data, t("adj_failed"), t));
                return;
            }
            setBalance(data.balance ?? null);
            setAmount("");
            setReason("");
            setAllowNegative(false);
            toast.success(t("adj_done", { name: member.username, balance: data.balance ?? 0 }));
        } catch {
            toast.error(t("adj_failed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <AdminPageHeader
                title={t("adj_title")}
                description={t("adj_subtitle")}
                onBack={() => router.push("/admin/credits/ledger")}
                backLabel={commonT("back")}
            />
            <Card>
                <CardContent className="p-6">
                    <form onSubmit={submit} className="space-y-4">
                        <div>
                            <UserPicker
                                id="adjust-member"
                                label={t("led_member")}
                                value={member}
                                onChange={(next) => { setMember(next); setBalance(null); }}
                                required
                            />
                            {member && balance !== null && (
                                <p role="status" className="mt-1 text-sm text-muted-foreground">
                                    {t("led_balanceOf", { name: member.username, balance })}
                                </p>
                            )}
                        </div>

                        <fieldset className="space-y-2">
                            <legend className="text-sm font-medium">{t("adj_direction")}</legend>
                            <RadioField
                                name="direction"
                                label={t("adj_add")}
                                checked={direction === "add"}
                                onChange={() => setDirection("add")}
                            />
                            <RadioField
                                name="direction"
                                label={t("adj_remove")}
                                checked={direction === "remove"}
                                onChange={() => setDirection("remove")}
                            />
                        </fieldset>

                        <div>
                            <Label htmlFor="adjust-amount">{t("amount")}</Label>
                            <Input
                                id="adjust-amount"
                                type="number"
                                min="1"
                                step="1"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                required
                            />
                        </div>

                        <div>
                            <Label htmlFor="adjust-reason">{t("reason")}</Label>
                            <Textarea
                                id="adjust-reason"
                                value={reason}
                                maxLength={500}
                                onChange={(e) => setReason(e.target.value)}
                                required
                            />
                            <p className="mt-1 text-xs text-muted-foreground">{t("adj_reasonHint")}</p>
                        </div>

                        {direction === "remove" && (
                            <CheckboxField
                                label={t("adj_allowNegative")}
                                description={t("adj_allowNegativeHint")}
                                checked={allowNegative}
                                onChange={(e) => setAllowNegative(e.target.checked)}
                            />
                        )}

                        <Button type="submit" disabled={saving || !ready} variant={direction === "remove" ? "destructive" : "default"}>
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                            {direction === "add" ? t("adj_add") : t("adj_remove")}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </>
    );
}
