"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
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
    useConfirm,
    useFormRoute,
    useSiteSettings,
} from "@/core/sdk/ui";
import { AdminPageHeader, ReferenceList, RowActions } from "@/core/sdk/admin";
import { dateLocaleTag, instantToWallClock, writeError } from "@/core/sdk";
import { MAX_SALE_PERCENT, MIN_SALE_PERCENT, saleState } from "../../../lib/store-sale";

/**
 * Store-wide sales: a percentage off the whole shop, or off chosen shelves,
 * between two dates.
 *
 * The dates are typed on the shop's clock and turned into instants on the
 * server, the same as a product's sale window. How a sale meets a product's
 * own sale price is `withStoreSale`, and the screen says it in one line so an
 * operator is not surprised that a product already at half price stays there.
 */

interface Sale {
    id: string;
    name: string;
    percent: number;
    categoryIds: string[];
    startsAt: string;
    endsAt: string;
    isActive: boolean;
}

interface Draft {
    name: string;
    percent: string;
    categoryIds: string[];
    startsAt: string;
    endsAt: string;
    isActive: boolean;
}

const EMPTY: Draft = { name: "", percent: "", categoryIds: [], startsAt: "", endsAt: "", isActive: true };

const STATE_TONE = { running: "success", scheduled: "info", ended: "neutral", off: "neutral" } as const;

export default function StoreSalesPage() {
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const localeTag = dateLocaleTag(useLocale());
    const { settings } = useSiteSettings();
    const timeZone = (settings.site_timezone as string) || "UTC";
    const { confirm } = useConfirm();

    const [sales, setSales] = useState<Sale[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    // The form is a screen at `?form=new` or `?form=<id>`, not a card above
    // the list of sales.
    const { showForm, editingId, openForm, closeForm } = useFormRoute();
    const [draft, setDraft] = useState<Draft>(EMPTY);

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
            const res = await fetch("/api/v1/store/admin/store-sales");
            if (!res.ok) throw new Error("read");
            const body = await res.json();
            setSales(Array.isArray(body.sales) ? body.sales : []);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    // Filled from the sale the address names once the rows arrive, so a
    // reload of `?form=<id>` lands on the same edit rather than an empty form.
    useEffect(() => {
        const sale = editingId ? sales.find((row) => row.id === editingId) : null;
        setDraft(sale
            ? {
                name: sale.name,
                percent: String(sale.percent),
                categoryIds: sale.categoryIds,
                startsAt: instantToWallClock(new Date(sale.startsAt), timeZone),
                endsAt: instantToWallClock(new Date(sale.endsAt), timeZone),
                isActive: sale.isActive,
            }
            : EMPTY);
    }, [editingId, sales, timeZone]);

    const save = async () => {
        setBusy(true);
        try {
            const url = editingId
                ? `/api/v1/store/admin/store-sales/${editingId}`
                : "/api/v1/store/admin/store-sales";
            const res = await fetch(url, {
                method: editingId ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: draft.name.trim(),
                    percent: Number(draft.percent) || 0,
                    categoryIds: draft.categoryIds,
                    startsAt: draft.startsAt,
                    endsAt: draft.endsAt,
                    isActive: draft.isActive,
                }),
            });
            const wrong = await writeError(res, t("adm_saleSaveFailed"), t);
            if (wrong) {
                toast.error(wrong);
                return;
            }
            toast.success(t("adm_saleSaved"));
            await load();
            closeForm();
        } catch {
            toast.error(t("adm_saleSaveFailed"));
        } finally {
            setBusy(false);
        }
    };

    const remove = async (sale: Sale) => {
        const sure = await confirm({ title: t("adm_saleDelete"), message: t("adm_saleDeleteConfirm", { name: sale.name }) });
        if (!sure) return;
        const res = await fetch(`/api/v1/store/admin/store-sales/${sale.id}`, { method: "DELETE" });
        const wrong = await writeError(res, t("adm_saleSaveFailed"), t);
        if (wrong) {
            toast.error(wrong);
            return;
        }
        toast.success(t("adm_saleDeleted"));
        await load();
    };

    if (loading) {
        return <Card><CardContent className="py-10 text-center text-muted-foreground">{commonT("loading")}</CardContent></Card>;
    }

    const header = (
        <AdminPageHeader
            title={t("adm_saleTitle")}
            description={t("adm_saleSubtitle")}
            actions={showForm ? undefined : (
                <Button variant="outline" onClick={() => openForm()}>
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    {t("adm_saleAdd")}
                </Button>
            )}
        />
    );
    if (failed) return <>{header}<Card><CardContent><LoadFailed onRetry={load} /></CardContent></Card></>;

    const when = (iso: string) => new Date(iso).toLocaleString(localeTag, { timeZone, dateStyle: "medium", timeStyle: "short" });
    const now = new Date();
    const percent = Number(draft.percent);
    const percentValid = Number.isInteger(percent) && percent >= MIN_SALE_PERCENT && percent <= MAX_SALE_PERCENT;

    return (
        <>
            {header}

            {showForm ? (
                <Card>
                    <CardHeader><CardTitle>{editingId ? t("adm_saleEdit") : t("adm_saleAdd")}</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                            <div>
                                <Label htmlFor="sale-name">{t("adm_saleName")}</Label>
                                <Input id="sale-name" value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                            </div>
                            <div>
                                <Label htmlFor="sale-percent">{t("adm_salePercent")}</Label>
                                <Input
                                    id="sale-percent"
                                    type="number"
                                    min={MIN_SALE_PERCENT}
                                    max={MAX_SALE_PERCENT}
                                    step={1}
                                    value={draft.percent}
                                    onChange={(e) => setDraft({ ...draft, percent: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label htmlFor="sale-starts">{t("adm_saleStarts")}</Label>
                                <Input id="sale-starts" type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
                            </div>
                            <div>
                                <Label htmlFor="sale-ends">{t("adm_saleEnds")}</Label>
                                <Input id="sale-ends" type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground">{t("adm_saleZone", { zone: timeZone })}</p>

                        <div>
                            <Label>{t("adm_saleCategories")}</Label>
                            <ReferenceList
                                value={draft.categoryIds}
                                onChange={(ids) => setDraft({ ...draft, categoryIds: ids })}
                                label={t("adm_saleCategories")}
                                endpoint="/api/v1/store/categories"
                                listKey="categories"
                                labelField="name"
                                hintField="slug"
                            />
                            <p className="mt-1 text-xs text-muted-foreground">{t("adm_saleCategoriesHint")}</p>
                        </div>

                        <p className="text-sm text-muted-foreground">{t("adm_saleRule")}</p>

                        <CheckboxField
                            label={t("adm_saleActive")}
                            checked={draft.isActive}
                            onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                        />

                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" disabled={busy} onClick={closeForm}>{commonT("cancel")}</Button>
                            <Button disabled={busy || draft.name.trim() === "" || !percentValid} onClick={save}>
                                {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
                                {t("adm_saleSave")}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : sales.length === 0 ? (
                <Card><CardContent className="py-10 text-center text-muted-foreground">{t("adm_saleNone")}</CardContent></Card>
            ) : (
                <div className="space-y-3">
                    {sales.map((sale) => {
                        const state = saleState({ ...sale, startsAt: new Date(sale.startsAt), endsAt: new Date(sale.endsAt) }, now);
                        return (
                            <Card key={sale.id}>
                                <CardContent className="py-4 space-y-2">
                                    <div className="flex items-center justify-between gap-3 flex-wrap">
                                        <p className="font-medium flex items-center gap-2">
                                            {sale.name}
                                            <Badge tone={STATE_TONE[state]}>{t(`adm_saleState_${state}`)}</Badge>
                                        </p>
                                        <RowActions
                                            actions={[
                                                { icon: Pencil, label: t("adm_saleEdit"), onClick: () => openForm(sale.id) },
                                                { icon: Trash2, label: t("adm_saleDelete"), onClick: () => void remove(sale), destructive: true },
                                            ]}
                                        />
                                    </div>
                                    <p className="text-sm">
                                        {sale.categoryIds.length === 0
                                            ? t("adm_saleWholeStore", { percent: sale.percent })
                                            : t("adm_saleShelves", { percent: sale.percent, count: sale.categoryIds.length })}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {t("adm_saleWindow", { starts: when(sale.startsAt), ends: when(sale.endsAt) })}
                                    </p>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </>
    );
}
