"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
    Button, Card, CardContent, CheckboxField, Input, Label, ListControls, LoadFailed,
    Pagination, buttonClassName, useConfirm, useFormRoute, useRowList, useSiteSettings,
} from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import { AdminPageHeader, RowActions } from "@/core/sdk/admin";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { writeError, errorMessage } from "@/core/sdk";
import { EMPTY_CAMPAIGN, campaignPayload, type CampaignFormValue } from "./campaign-form";
import { timeFromMinutes } from "../products/_fields/time-of-day";

/**
 * Campaigns: one price change an operator sets once and lets run on a clock.
 *
 * The price box beside each product is the dangerous part of this screen, and
 * `campaign-form.ts` is where that is handled: a box left empty means the
 * product is not in the campaign, because `Number("")` is 0 and 0 is free.
 */

interface Campaign {
    id: string;
    name: string;
    isActive: boolean;
    days: number[];
    fromMinute: number | null;
    untilMinute: number | null;
    entries: { productId: string; price: string | number; stock: number | null }[];
}

interface Product {
    id: string;
    name: string;
}

export default function AdminStoreCampaignsPage() {
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();
    const { settings } = useSiteSettings();
    const timeZone = (settings.site_timezone as string) || "UTC";
    const { showForm, formHref, editingId, closeForm } = useFormRoute();

    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    // The name is what the card draws and what an operator remembers.
    const list = useRowList(campaigns, { text: (c) => [c.name], pageSize: 20 });
    const [products, setProducts] = useState<Product[]>([]);
    const [form, setForm] = useState<CampaignFormValue>(EMPTY_CAMPAIGN);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            fetch("/api/v1/store/campaigns").then((r) => { if (!r.ok) throw new Error("load"); return r.json(); }),
            fetch("/api/v1/store/admin/products?limit=200").then((r) => { if (!r.ok) throw new Error("load"); return r.json(); }),
        ])
            .then(([campaignData, productData]) => {
                if (cancelled) return;
                setCampaigns(campaignData.campaigns ?? []);
                setProducts((productData.products ?? []).map((p: Product) => ({ id: p.id, name: p.name })));
                setFailed(false);
            })
            .catch(() => { if (!cancelled) setFailed(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [reloadKey]);

    // Opening the form on a row fills it from what is already loaded; leaving
    // edit clears it, so the next "new" does not start with the last one's name.
    useEffect(() => {
        if (!editingId) { setForm(EMPTY_CAMPAIGN); return; }
        const row = campaigns.find((c) => c.id === editingId);
        if (!row) return;
        setForm({
            name: row.name,
            isActive: row.isActive,
            days: row.days ?? [],
            from24: timeFromMinutes(row.fromMinute),
            until24: timeFromMinutes(row.untilMinute),
            entries: (row.entries ?? []).map((entry) => ({
                productId: entry.productId,
                price: String(entry.price),
                stock: entry.stock === null ? "" : String(entry.stock),
            })),
        });
    }, [editingId, campaigns]);

    const set = (patch: Partial<CampaignFormValue>) => setForm({ ...form, ...patch });

    const toggleDay = (day: number) =>
        set({ days: form.days.includes(day) ? form.days.filter((d) => d !== day) : [...form.days, day].sort() });

    const entryFor = (productId: string) =>
        form.entries.find((entry) => entry.productId === productId);

    const setEntry = (productId: string, patch: { price?: string; stock?: string }) => {
        const rest = form.entries.filter((entry) => entry.productId !== productId);
        const current = entryFor(productId) ?? { productId, price: "", stock: "" };
        set({ entries: [...rest, { ...current, ...patch }] });
    };

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const target = editingId
                ? { url: `/api/v1/store/campaigns/${editingId}`, method: "PATCH" }
                : { url: "/api/v1/store/campaigns", method: "POST" };
            const res = await fetch(target.url, {
                method: target.method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(campaignPayload(form)),
            });
            const wrong = await writeError(res, t("adm_campaignSaveFailed"), t);
            if (wrong) { setError(wrong); return; }
            setForm(EMPTY_CAMPAIGN);
            setReloadKey((k) => k + 1);
            closeForm();
        } catch {
            setError(commonT("somethingWentWrong"));
        } finally {
            setSaving(false);
        }
    };

    const remove = async (id: string) => {
        const ok = await confirm({
            title: t("adm_campaignDeleteTitle"),
            message: t("adm_campaignDeleteConfirm"),
            confirmText: commonT("delete"),
            variant: "danger",
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/store/campaigns/${id}`, { method: "DELETE" });
        if (res.ok) {
            setReloadKey((k) => k + 1);
            toast.success(t("adm_campaignDeleted"));
        } else {
            toast.error(errorMessage(await res.json(), commonT("somethingWentWrong"), commonT));
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (failed) return <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />;

    if (showForm) {
        return (
            <>
                <AdminPageHeader
                    title={editingId ? t("adm_campaignEdit") : t("adm_campaignNew")}
                    description={t("adm_campaignHint", { zone: timeZone })}
                    onBack={closeForm}
                    backLabel={commonT("back")}
                />

                {error && (
                    <div role="alert" className="mb-6 rounded-lg bg-destructive/10 p-4 text-destructive">{error}</div>
                )}

                <Card>
                    <CardContent className="space-y-6 p-6">
                        <form onSubmit={save} className="space-y-6">
                            <div>
                                <Label htmlFor="campaignName">{`${t("adm_campaignName")} *`}</Label>
                                <Input
                                    id="campaignName"
                                    value={form.name}
                                    onChange={(e) => set({ name: e.target.value })}
                                    required
                                />
                            </div>

                            <CheckboxField
                                id="campaignActive"
                                label={t("adm_campaignActive")}
                                description={t("adm_campaignActiveHint")}
                                checked={form.isActive}
                                onChange={(e) => set({ isActive: e.target.checked })}
                            />

                            <div>
                                <Label>{t("adm_campaignDays")}</Label>
                                <div className="mt-2 flex flex-wrap gap-3">
                                    {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                                        <CheckboxField
                                            key={day}
                                            id={`campaign-day-${day}`}
                                            label={t(`adm_day_${day}`)}
                                            checked={form.days.includes(day)}
                                            onChange={() => toggleDay(day)}
                                        />
                                    ))}
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground">{t("adm_campaignDaysHint")}</p>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <Label htmlFor="campaignFrom">{t("adm_campaignFrom")}</Label>
                                    <Input
                                        id="campaignFrom"
                                        type="time"
                                        value={form.from24}
                                        onChange={(e) => set({ from24: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="campaignUntil">{t("adm_campaignUntil")}</Label>
                                    <Input
                                        id="campaignUntil"
                                        type="time"
                                        value={form.until24}
                                        onChange={(e) => set({ until24: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div>
                                <Label>{t("adm_campaignProducts")}</Label>
                                <p className="mb-2 text-sm text-muted-foreground">{t("adm_campaignProductsHint")}</p>
                                {products.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">{t("adm_requiresNothingToPick")}</p>
                                ) : (
                                    <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                                        {products.map((product) => (
                                            <div key={product.id} className="grid items-center gap-2 md:grid-cols-[1fr_8rem_8rem]">
                                                <span className="truncate text-sm">{product.name}</span>
                                                <Input
                                                    aria-label={t("adm_campaignPriceFor", { product: product.name })}
                                                    type="number"
                                                    min={0}
                                                    step="0.01"
                                                    placeholder={t("adm_campaignPricePlaceholder")}
                                                    value={entryFor(product.id)?.price ?? ""}
                                                    onChange={(e) => setEntry(product.id, { price: e.target.value })}
                                                />
                                                <Input
                                                    aria-label={t("adm_campaignStockFor", { product: product.name })}
                                                    type="number"
                                                    min={1}
                                                    placeholder={t("adm_campaignStockPlaceholder")}
                                                    value={entryFor(product.id)?.stock ?? ""}
                                                    onChange={(e) => setEntry(product.id, { stock: e.target.value })}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-2">
                                <Button type="submit" disabled={saving}>
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    {editingId ? t("adm_campaignSave") : t("adm_campaignCreate")}
                                </Button>
                                <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>
                                    {commonT("cancel")}
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            </>
        );
    }

    return (
        <>
            <AdminPageHeader
                title={t("adm_campaigns")}
                description={t("adm_campaignsSubtitle")}
                actions={
                    <Link href={formHref()} className={buttonClassName("default", "default")}>
                        <Plus className="h-4 w-4" aria-hidden="true" /> {t("adm_campaignNew")}
                    </Link>
                }
            />

            <ListControls className="mb-4" search={{ value: list.search, onChange: list.setSearch }} />

            {campaigns.length === 0 ? (
                <Card>
                    <CardContent className="py-8 text-center">
                        <p className="text-muted-foreground">{t("adm_campaignsNone")}</p>
                    </CardContent>
                </Card>
            ) : list.rows.length === 0 ? (
                <Card>
                    <CardContent className="py-8 text-center">
                        <p className="text-muted-foreground">{commonT("noResults")}</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {list.rows.map((campaign) => (
                        <Card key={campaign.id}>
                            <CardContent className="flex items-center justify-between p-4">
                                <div className="min-w-0">
                                    <p className="font-medium">{campaign.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {t("adm_campaignSummary", {
                                            count: campaign.entries?.length ?? 0,
                                            from: timeFromMinutes(campaign.fromMinute) || t("adm_campaignAllDay"),
                                            until: timeFromMinutes(campaign.untilMinute) || t("adm_campaignAllDay"),
                                        })}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`rounded px-2 py-1 text-xs ${campaign.isActive ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                                        {campaign.isActive ? t("adm_active") : t("adm_inactive")}
                                    </span>
                                    <RowActions
                                        actions={[
                                            { icon: Pencil, label: commonT("edit"), href: formHref(campaign.id) },
                                            { icon: Trash2, label: commonT("delete"), onClick: () => remove(campaign.id), destructive: true },
                                        ]}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                    <Pagination
                        page={list.page}
                        pages={list.pages}
                        total={list.total}
                        onPageChange={list.setPage}
                    />
                </div>
            )}
        </>
    );
}
