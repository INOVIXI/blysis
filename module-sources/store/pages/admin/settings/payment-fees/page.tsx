"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Badge,
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CheckboxField,
    Input,
    Label,
    LoadFailed,
    NativeSelect,
    Waiting,
    useConfirm,
} from "@/core/sdk/ui";
import { AdminPageHeader } from "@/core/sdk/admin";
import { writeError } from "@/core/sdk";

/**
 * The fee each payment method passes on to the buyer.
 *
 * Every method the shop offers is listed, not only the gateways that offer a
 * fee of their own. A method the operator has not touched shows what its
 * gateway offers, which is what the checkout charges until a row is saved;
 * "use the gateway's setting" removes the row again.
 */

interface FeeRow {
    passOn: boolean;
    percent: number;
    fixed: number;
    fixedCurrency: string | null;
}

interface Method {
    id: string;
    label: string;
    row: FeeRow | null;
    gatewayFee: { percent: number; fixed: number } | null;
}

interface Draft {
    passOn: boolean;
    percent: string;
    fixed: string;
    fixedCurrency: string;
}

function draftOf(method: Method): Draft {
    const row = method.row;
    if (row) {
        return {
            passOn: row.passOn,
            percent: String(row.percent),
            fixed: String(row.fixed),
            fixedCurrency: row.fixedCurrency ?? "",
        };
    }
    return {
        passOn: method.gatewayFee !== null,
        percent: String(method.gatewayFee?.percent ?? 0),
        fixed: String(method.gatewayFee?.fixed ?? 0),
        fixedCurrency: "",
    };
}

/** Every currency the browser knows, so a processor's quote can be typed as it is written. */
function currencyCodes(): string[] {
    try {
        return Intl.supportedValuesOf("currency");
    } catch {
        return [];
    }
}

export default function PaymentFeesPage() {
    const t = useTranslations("store");
    const { confirm } = useConfirm();
    const [currency, setCurrency] = useState("");
    const [methods, setMethods] = useState<Method[] | null>(null);
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const [failed, setFailed] = useState(false);
    const [saving, setSaving] = useState<string | null>(null);
    const codes = useMemo(() => currencyCodes(), []);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const res = await fetch("/api/v1/store/admin/payment-fees");
            if (!res.ok) throw new Error(String(res.status));
            const data = (await res.json()) as { currency: string; methods: Method[] };
            setCurrency(data.currency);
            setMethods(data.methods);
            setDrafts(Object.fromEntries(data.methods.map((method) => [method.id, draftOf(method)])));
        } catch {
            setFailed(true);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const edit = (id: string, change: Partial<Draft>) =>
        setDrafts((all) => ({ ...all, [id]: { ...all[id], ...change } }));

    const save = async (id: string) => {
        const draft = drafts[id];
        setSaving(id);
        try {
            const res = await fetch("/api/v1/store/admin/payment-fees", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider: id,
                    passOn: draft.passOn,
                    percent: Number(draft.percent) || 0,
                    fixed: Number(draft.fixed) || 0,
                    fixedCurrency: draft.fixedCurrency === "" ? null : draft.fixedCurrency,
                }),
            });
            const error = await writeError(res, t("fees_saveFailed"), t);
            if (error) {
                toast.error(error);
                return;
            }
            toast.success(t("fees_saved"));
            await load();
        } finally {
            setSaving(null);
        }
    };

    const reset = async (method: Method) => {
        const ok = await confirm({
            title: t("fees_useGateway"),
            message: t("fees_useGatewayConfirm", { method: method.label }),
            confirmText: t("fees_useGateway"),
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/store/admin/payment-fees?provider=${encodeURIComponent(method.id)}`, {
            method: "DELETE",
        });
        const error = await writeError(res, t("fees_saveFailed"), t);
        if (error) {
            toast.error(error);
            return;
        }
        await load();
    };

    return (
        <div className="space-y-6">
            <AdminPageHeader title={t("fees_title")} description={t("fees_subtitle")} />

            {failed ? (
                <LoadFailed onRetry={load} />
            ) : methods === null ? (
                <Waiting label={t("fees_loading")} />
            ) : methods.length === 0 ? (
                <Card>
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">{t("fees_noMethods")}</CardContent>
                </Card>
            ) : (
                methods.map((method) => {
                    const draft = drafts[method.id];
                    if (!draft) return null;
                    const prefix = `fee-${method.id}`;
                    return (
                        <Card key={method.id}>
                            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                                <CardTitle className="text-base">{method.label}</CardTitle>
                                {method.row ? (
                                    <Badge tone="info">{t("fees_setHere")}</Badge>
                                ) : method.gatewayFee ? (
                                    <Badge tone="neutral">
                                        {t("fees_fromGateway", {
                                            percent: method.gatewayFee.percent,
                                            fixed: method.gatewayFee.fixed,
                                            currency,
                                        })}
                                    </Badge>
                                ) : (
                                    <Badge tone="neutral">{t("fees_none")}</Badge>
                                )}
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <CheckboxField
                                    label={t("fees_passOn")}
                                    description={t("fees_passOnHelp")}
                                    checked={draft.passOn}
                                    onChange={(e) => edit(method.id, { passOn: e.target.checked })}
                                />
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                    <div className="space-y-1">
                                        <Label htmlFor={`${prefix}-percent`}>{t("fees_percent")}</Label>
                                        <Input
                                            id={`${prefix}-percent`}
                                            type="number"
                                            min={0}
                                            max={99.99}
                                            step={0.01}
                                            disabled={!draft.passOn}
                                            value={draft.percent}
                                            onChange={(e) => edit(method.id, { percent: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor={`${prefix}-fixed`}>{t("fees_fixed")}</Label>
                                        <Input
                                            id={`${prefix}-fixed`}
                                            type="number"
                                            min={0}
                                            step={0.01}
                                            disabled={!draft.passOn}
                                            value={draft.fixed}
                                            onChange={(e) => edit(method.id, { fixed: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor={`${prefix}-currency`}>{t("fees_fixedCurrency")}</Label>
                                        <NativeSelect
                                            id={`${prefix}-currency`}
                                            className="w-full"
                                            disabled={!draft.passOn}
                                            value={draft.fixedCurrency}
                                            onChange={(e) => edit(method.id, { fixedCurrency: e.target.value })}
                                        >
                                            <option value="">{t("fees_shopCurrency", { currency })}</option>
                                            {codes.map((code) => (
                                                <option key={code} value={code}>
                                                    {code}
                                                </option>
                                            ))}
                                        </NativeSelect>
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground">{t("fees_conversionHelp")}</p>
                                <div className="flex flex-wrap gap-2">
                                    <Button onClick={() => save(method.id)} disabled={saving === method.id}>
                                        {saving === method.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                        ) : (
                                            <Save className="h-4 w-4" aria-hidden="true" />
                                        )}
                                        {t("fees_save")}
                                    </Button>
                                    {method.row && (
                                        <Button variant="outline" onClick={() => reset(method)}>
                                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                                            {t("fees_useGateway")}
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    );
                })
            )}
        </div>
    );
}
