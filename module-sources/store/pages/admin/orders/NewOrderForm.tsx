"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
    Button, Card, CardContent, CheckboxField, Input, Label, LoadFailed,
    NativeSelect, Textarea, useSiteCurrency,
} from "@/core/sdk/ui";
import { AdminPageHeader, UserPicker, type PickedUser } from "@/core/sdk/admin";
import { writeError } from "@/core/sdk";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
    EMPTY_MANUAL_ORDER, manualOrderPayload,
    type ManualLineValue, type ManualOrderFormValue,
} from "./manual-order-form";

/**
 * An order typed in by hand: money that arrived by bank transfer, a
 * replacement for an order that went wrong, a sale agreed in a message.
 *
 * The buyer is searched for rather than picked from a list, because a site
 * with ten thousand accounts cannot draw a dropdown of them. `UserPicker` is
 * that search, already written and debounced for the two core screens that
 * ask the same question.
 *
 * Whether it grants what it names is a deliberate switch, not a default. An
 * operator recording a sale that has already been delivered wants the record
 * without the delivery, and the same screen serves both.
 */

interface Product {
    id: string;
    name: string;
    price: string | number;
}

const BLANK_LINE: ManualLineValue = { productId: "", quantity: "1", unitAmount: "" };

export function NewOrderForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const { base } = useSiteCurrency();

    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    const [form, setForm] = useState<ManualOrderFormValue>({
        ...EMPTY_MANUAL_ORDER,
        lines: [{ ...BLANK_LINE }],
    });
    const [buyer, setBuyer] = useState<PickedUser | null>(null);

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch("/api/v1/store/admin/products?limit=200")
            .then((res) => { if (!res.ok) throw new Error("load"); return res.json(); })
            .then((data) => {
                if (cancelled) return;
                setProducts(data.products ?? []);
                setFailed(false);
            })
            .catch(() => { if (!cancelled) setFailed(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [reloadKey]);

    const set = (patch: Partial<ManualOrderFormValue>) => setForm((current) => ({ ...current, ...patch }));

    const setLine = (index: number, patch: Partial<ManualLineValue>) =>
        set({ lines: form.lines.map((line, at) => (at === index ? { ...line, ...patch } : line)) });

    // Choosing a product fills the price with what it sells for, which is what
    // an operator wants nine times out of ten and can still type over.
    const chooseProduct = (index: number, productId: string) => {
        const priced = products.find((product) => product.id === productId);
        setLine(index, {
            productId,
            unitAmount: priced ? String(Number(priced.price)) : form.lines[index].unitAmount,
        });
    };

    const total = form.lines.reduce((sum, line) => {
        const amount = Number(line.unitAmount);
        const quantity = line.quantity.trim() === "" ? 1 : Number(line.quantity);
        if (!Number.isFinite(amount) || !Number.isFinite(quantity)) return sum;
        return sum + amount * quantity;
    }, 0);

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);

        const asked = manualOrderPayload({ ...form, currency: base });
        if ("noBuyer" in asked) { setError(t("adm_manualOrderNoBuyer")); return; }
        if ("empty" in asked) { setError(t("adm_manualOrderNoLines")); return; }
        if ("blankPrice" in asked) {
            setError(t("adm_manualOrderBlankPrice", { line: asked.blankPrice }));
            return;
        }

        setSaving(true);
        try {
            const res = await fetch("/api/v1/store/admin/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(asked.payload),
            });
            const wrong = await writeError(res, t("adm_manualOrderFailed"), t);
            if (wrong) { setError(wrong); return; }
            onDone();
        } catch {
            setError(commonT("somethingWentWrong"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (failed) return <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />;

    return (
        <>
            <AdminPageHeader
                title={t("adm_manualOrderNew")}
                description={t("adm_manualOrderHint")}
                onBack={onCancel}
                backLabel={commonT("back")}
            />

            {error && (
                <div role="alert" className="mb-6 rounded-lg bg-destructive/10 p-4 text-destructive">{error}</div>
            )}

            <Card>
                <CardContent className="p-6">
                    <form onSubmit={save} className="space-y-6">
                        <UserPicker
                            id="manualOrderBuyer"
                            label={`${t("adm_manualOrderBuyer")} *`}
                            placeholder={t("adm_manualOrderBuyerPlaceholder")}
                            value={buyer}
                            onChange={(picked) => {
                                setBuyer(picked);
                                set({ userId: picked?.id ?? "" });
                            }}
                            required
                        />

                        <div>
                            <Label>{t("adm_manualOrderLines")}</Label>
                            {/*
                              * The two number boxes are anonymous without this.
                              * Each carries an accessible name already, so the
                              * row is hidden from a screen reader rather than
                              * read out again before every line.
                              */}
                            <div
                                aria-hidden="true"
                                className="mt-2 hidden gap-2 text-xs text-muted-foreground md:grid md:grid-cols-[1fr_6rem_8rem_auto]"
                            >
                                <span>{t("adm_product")}</span>
                                <span>{t("adm_quantity")}</span>
                                <span>{t("adm_price")}</span>
                                <span className="w-9" />
                            </div>
                            <div className="mt-2 space-y-2">
                                {form.lines.map((line, index) => (
                                    <div key={index} className="grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_6rem_8rem_auto]">
                                        <div>
                                            <NativeSelect
                                                aria-label={t("adm_manualOrderProductFor", { line: index + 1 })}
                                                value={line.productId}
                                                onChange={(e) => chooseProduct(index, e.target.value)}
                                            >
                                                <option value="">{t("adm_manualOrderPickProduct")}</option>
                                                {products.map((product) => (
                                                    <option key={product.id} value={product.id}>{product.name}</option>
                                                ))}
                                            </NativeSelect>
                                        </div>
                                        <Input
                                            aria-label={t("adm_manualOrderQuantityFor", { line: index + 1 })}
                                            type="number"
                                            min={1}
                                            step="1"
                                            value={line.quantity}
                                            onChange={(e) => setLine(index, { quantity: e.target.value })}
                                        />
                                        <Input
                                            aria-label={t("adm_manualOrderPriceFor", { line: index + 1 })}
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            value={line.unitAmount}
                                            onChange={(e) => setLine(index, { unitAmount: e.target.value })}
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            aria-label={t("adm_manualOrderRemoveLine", { line: index + 1 })}
                                            disabled={form.lines.length === 1}
                                            onClick={() => set({ lines: form.lines.filter((_, at) => at !== index) })}
                                        >
                                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="mt-2"
                                onClick={() => set({ lines: [...form.lines, { ...BLANK_LINE }] })}
                            >
                                <Plus className="h-4 w-4" aria-hidden="true" /> {t("adm_manualOrderAddLine")}
                            </Button>
                        </div>

                        <div>
                            <Label htmlFor="manualOrderNotes">{t("adm_manualOrderNotes")}</Label>
                            <Textarea
                                id="manualOrderNotes"
                                rows={3}
                                maxLength={500}
                                value={form.notes}
                                onChange={(e) => set({ notes: e.target.value })}
                                placeholder={t("adm_manualOrderNotesPlaceholder")}
                            />
                        </div>

                        <CheckboxField
                            id="manualOrderMarkPaid"
                            label={t("adm_manualOrderMarkPaid")}
                            description={t("adm_manualOrderMarkPaidHint")}
                            checked={form.markPaid}
                            onChange={(e) => set({ markPaid: e.target.checked })}
                        />

                        <p className="text-sm text-muted-foreground">
                            {t("adm_manualOrderTotal", { amount: total.toFixed(2), currency: base })}
                        </p>

                        <div className="flex gap-2">
                            <Button type="submit" disabled={saving}>
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                {t("adm_manualOrderCreate")}
                            </Button>
                            <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
                                {commonT("cancel")}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </>
    );
}
