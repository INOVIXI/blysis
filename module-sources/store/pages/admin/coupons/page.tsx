"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback } from "react";
import { Badge, Button, Card, CardContent, Checkbox, Input, Label, ListControls, Pagination, useConfirm, useFormRoute, useRowList, useSiteCurrency, NativeSelect, buttonClassName, useLocalDate } from "@/core/sdk/ui";
import { couponStanding, STANDING_TONE } from "../../../lib/coupon-standing";
import { Link } from "@/core/sdk/navigation";
import { Loader2, Pencil, Plus, ToggleLeft, ToggleRight, Trash2, Tag } from "lucide-react";
import { toast } from "sonner";
import { deleteEach, errorMessage, writeError } from "@/core/sdk";
import { AdminPageHeader, BulkBar, ReferenceList, RowActions } from "@/core/sdk/admin";

interface Coupon {
    id: string;
    code: string;
    description: string | null;
    type: "PERCENTAGE" | "FIXED";
    value: number;
    minPurchase: number | null;
    maxDiscount: number | null;
    usageLimit: number | null;
    usageCount: number;
    startsAt: string | null;
    expiresAt: string | null;
    productIds?: string[];
    categoryIds?: string[];
    isActive: boolean;
}

export default function AdminCouponsPage() {
    const { format: money } = useSiteCurrency();
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();
    const [coupons, setCoupons] = useState<Coupon[]>([]);
    // The endpoint stops at 500 rows and says when it did.
    const [truncated, setTruncated] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    // The editor is a screen at `?form=new` or `?form=<id>`, not a card above
    // the table of coupons.
    const { showForm, editingId, formHref, openForm, closeForm } = useFormRoute();
    const [error, setError] = useState<string | null>(null);

    // The two lines the table draws. This list grows every time somebody
    // adds one, and paging to a row was the only way to reach it.
    const list = useRowList(coupons, { text: (c) => [c.code, c.description], pageSize: 10 });

    const [form, setForm] = useState({
        code: "",
        description: "",
        type: "PERCENTAGE" as "PERCENTAGE" | "FIXED",
        value: "",
        minPurchase: "",
        maxDiscount: "",
        usageLimit: "",
        startsAt: "",
        expiresAt: "",
        productIds: [] as string[],
        categoryIds: [] as string[],
        isActive: true,
    });

    const fetchCoupons = useCallback(async () => {
        try {
            const res = await fetch("/api/v1/store/coupons");
            if (res.ok) {
                const data = await res.json();
                setCoupons(data.coupons || []);
                setTruncated(Boolean(data.truncated));
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCoupons();
    }, [fetchCoupons]);

    // Filled from the coupon the URL names, once the rows arrive, so a reload
    // of `?form=<id>` lands on the same edit rather than an empty form.
    useEffect(() => {
        setError(null);
        if (!editingId) {
            setForm({ code: "", description: "", type: "PERCENTAGE", value: "", minPurchase: "", maxDiscount: "", usageLimit: "", startsAt: "", expiresAt: "", productIds: [], categoryIds: [], isActive: true });
            return;
        }
        const coupon = coupons.find((row) => row.id === editingId);
        if (!coupon) return;
        setForm({
            code: coupon.code,
            description: coupon.description || "",
            type: coupon.type,
            value: String(coupon.value),
            minPurchase: coupon.minPurchase ? String(coupon.minPurchase) : "",
            maxDiscount: coupon.maxDiscount ? String(coupon.maxDiscount) : "",
            usageLimit: coupon.usageLimit ? String(coupon.usageLimit) : "",
            startsAt: coupon.startsAt ? new Date(coupon.startsAt).toISOString().slice(0, 16) : "",
            expiresAt: coupon.expiresAt ? new Date(coupon.expiresAt).toISOString().slice(0, 16) : "",
            productIds: coupon.productIds ?? [],
            categoryIds: coupon.categoryIds ?? [],
            isActive: coupon.isActive,
        });
    }, [editingId, coupons]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);

        try {
            const url = editingId ? `/api/v1/store/coupons/${editingId}` : "/api/v1/store/coupons";
            const res = await fetch(url, {
                method: editingId ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: form.code.toUpperCase(),
                    description: form.description || undefined,
                    type: form.type,
                    value: parseFloat(form.value),
                    minPurchase: form.minPurchase ? parseFloat(form.minPurchase) : null,
                    maxDiscount: form.maxDiscount ? parseFloat(form.maxDiscount) : null,
                    usageLimit: form.usageLimit ? parseInt(form.usageLimit) : null,
                    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
                    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
                    productIds: form.productIds,
                    categoryIds: form.categoryIds,
                    isActive: form.isActive,
                }),
            });

            const failed = await writeError(res, t("adm_createCouponFailed"), t);
            if (failed) {
                setError(failed);
                return;
            }

            await fetchCoupons();
            closeForm();
        } catch {
            setError(commonT("somethingWentWrong"));
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (coupon: Coupon) => {
        try {
            const res = await fetch(`/api/v1/store/coupons/${coupon.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isActive: !coupon.isActive }),
            });
            const failed = await writeError(res, t("adm_writeFailed"), t);
            if (failed) { toast.error(failed); return; }
            fetchCoupons();
        } catch (err) {
            console.error(err);
        }
    };

    const deleteMany = async () => {
        const ok = await confirm({
            title: t("cou_deleteTitle"),
            message: t("adm_deleteManyConfirm", { count: list.picked.size }),
            variant: "danger",
            confirmText: commonT("delete"),
        });
        if (!ok) return;
        const { deleted, total } = await deleteEach([...list.picked], async (id) => {
            const res = await fetch(`/api/v1/store/coupons/${id}`, { method: "DELETE" });
            return res.ok;
        });
        list.clear();
        fetchCoupons();
        if (deleted === total) toast.success(t("cou_deletedToast"));
        else if (deleted === 0) toast.error(t("cou_deleteError"));
        else toast.error(t("adm_deletedPartly", { deleted, total }));
    };

    const deleteCoupon = async (id: string) => {
        const ok = await confirm({
            title: t("cou_deleteTitle"),
            message: t("cou_deleteConfirm"),
            confirmText: t("cou_delete"),
            variant: "danger",
        });
        if (!ok) return;
        try {
            const res = await fetch(`/api/v1/store/coupons/${id}`, { method: "DELETE" });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(errorMessage(data, t("cou_deleteError"), t));
                return;
            }
            toast.success(t("cou_deletedToast"));
            fetchCoupons();
        } catch {
            toast.error(t("cou_deleteError"));
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (showForm) {
        return (
            <>
                <AdminPageHeader
                    title={editingId ? t("adm_editCoupon") : t("adm_newCoupon")}
                    description={t("adm_manageDiscountCodes")}
                    onBack={closeForm}
                    backLabel={commonT("back")}
                />

                {error && (
                    <div role="alert" className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
                )}

                <Card>
                    <CardContent className="p-6">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid md:grid-cols-3 gap-4">
                                <div>
                                    <Label>{`${t("adm_code")} *`}</Label>
                                    <Input
                                        aria-label={t("adm_code")}
                                        value={form.code}
                                        onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                                        placeholder="SUMMER2024"
                                        required
                                        minLength={3}
                                    />
                                </div>
                                <div>
                                    <Label>{t("adm_type")}</Label>
                                    <NativeSelect
                                        aria-label={t("adm_type")}
                                        value={form.type}
                                        onChange={(e) => setForm({ ...form, type: e.target.value as "PERCENTAGE" | "FIXED" })} className="w-full"
                                    >
                                        <option value="PERCENTAGE">{t("adm_percentageType")}</option>
                                        <option value="FIXED">{t("adm_fixedType")}</option>
                                    </NativeSelect>
                                </div>
                                <div>
                                    <Label>{`${t("adm_value")} *`}</Label>
                                    <Input
                                        aria-label={t("adm_value")}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={form.value}
                                        onChange={(e) => setForm({ ...form, value: e.target.value })}
                                        placeholder={form.type === "PERCENTAGE" ? "10" : "5.00"}
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <Label>{t("adm_description")}</Label>
                                <Input
                                    aria-label={t("adm_description")}
                                    value={form.description}
                                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                                    placeholder={t("adm_couponNotePlaceholder")}
                                />
                            </div>

                            {/* Where the offer runs. Nothing named is every
                                product, which is what every coupon written
                                before this meant, so an existing one keeps
                                working untouched. */}
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <Label>{t("adm_couponProducts")}</Label>
                                    <ReferenceList
                                        value={form.productIds}
                                        onChange={(ids) => setForm({ ...form, productIds: ids })}
                                        label={t("adm_couponProducts")}
                                        endpoint="/api/v1/store/admin/products"
                                        listKey="products"
                                        labelField="name"
                                        hintField="slug"
                                    />
                                    <p className="mt-1 text-xs text-muted-foreground">{t("adm_couponScopeHint")}</p>
                                </div>
                                <div>
                                    <Label>{t("adm_couponCategories")}</Label>
                                    <ReferenceList
                                        value={form.categoryIds}
                                        onChange={(ids) => setForm({ ...form, categoryIds: ids })}
                                        label={t("adm_couponCategories")}
                                        endpoint="/api/v1/store/categories"
                                        listKey="categories"
                                        labelField="name"
                                        hintField="slug"
                                    />
                                </div>
                            </div>

                            <div className="grid md:grid-cols-3 gap-4">
                                <div>
                                    <Label>{t("adm_minPurchase")}</Label>
                                    <Input
                                        aria-label={t("adm_minPurchase")}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={form.minPurchase}
                                        onChange={(e) => setForm({ ...form, minPurchase: e.target.value })}
                                        placeholder={t("adm_noMinimum")}
                                    />
                                </div>
                                <div>
                                    <Label>{t("adm_maxDiscount")}</Label>
                                    <Input
                                        aria-label={t("adm_maxDiscount")}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={form.maxDiscount}
                                        onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
                                        placeholder={t("adm_noLimit")}
                                    />
                                </div>
                                <div>
                                    <Label>{t("adm_usageLimit")}</Label>
                                    <Input
                                        aria-label={t("adm_usageLimit")}
                                        type="number"
                                        min="1"
                                        value={form.usageLimit}
                                        onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
                                        placeholder={t("adm_unlimited")}
                                    />
                                </div>
                            </div>

                            {/*
                              * Both ends of the window. `startsAt` was read
                              * from the row, honoured by the basket and shown
                              * as nothing: a code meant to open on Friday
                              * could only be made through the API, or made
                              * live and switched off until Friday by hand.
                              */}
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <Label>{t("adm_couponStarts")}</Label>
                                    <Input
                                        aria-label={t("adm_couponStarts")}
                                        type="datetime-local"
                                        value={form.startsAt}
                                        onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                                    />
                                    <p className="mt-1 text-xs text-muted-foreground">{t("adm_couponStartsHint")}</p>
                                </div>
                                <div>
                                    <Label>{t("adm_expiresAt")}</Label>
                                    <Input
                                        aria-label={t("adm_expiresAt")}
                                        type="datetime-local"
                                        value={form.expiresAt}
                                        onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                                    />
                                    <p className="mt-1 text-xs text-muted-foreground">{t("adm_couponExpiresHint")}</p>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <Button type="submit" disabled={saving}>
                                    {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_saving")}</> : editingId ? t("adm_saveChanges") : t("adm_createCoupon")}
                                </Button>
                                <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>
                                    {t("adm_cancel")}
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
                title={t("adm_coupons")}
                description={t("adm_manageDiscountCodes")}
                actions={<>
                    <Link href={formHref()} className={buttonClassName("default", "default")}><Plus className="w-4 h-4" /> {t("adm_newCoupon")}</Link>
                </>}
            />

            {truncated && (
                <p role="status" className="mb-4 text-sm text-muted-foreground">
                    {t("adm_listTruncated")}
                </p>
            )}

            <ListControls className="mb-4" search={{ value: list.search, onChange: list.setSearch }} />

            {/* Coupons List */}
            <Card>
                <CardContent className="p-0">
                    {coupons.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">{t("adm_noCouponsYet")}</p>
                    ) : list.rows.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">{commonT("noResults")}</p>
                    ) : (
                        <>
                            {/* Outside the scrolling box: a bar that scrolled
                                sideways with the table would take the
                                select-all box off a narrow screen. */}
                            <BulkBar
                                state={list.headerState}
                                count={list.picked.size}
                                onToggleAll={list.toggleAll}
                                actions={
                                    <Button variant="destructive" size="sm" onClick={deleteMany}>
                                        <Trash2 className="w-4 h-4" /> {commonT("delete")} {list.picked.size}
                                    </Button>
                                }
                            />
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b">
                                        <th className="w-10 py-3 px-4" />
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_code")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_discount")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_usage")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_expires")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_status")}</th>
                                        <th className="text-right py-3 px-4 font-medium text-muted-foreground">{t("adm_actions")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {list.rows.map((coupon) => (
                                        <tr key={coupon.id} className="hover:bg-muted/50 border-b last:border-0">
                                            <td className="py-3 px-4">
                                                <Checkbox
                                                    checked={list.picked.has(coupon.id)}
                                                    onChange={() => list.toggle(coupon.id)}
                                                    aria-label={t("adm_selectRow")}
                                                />
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-2">
                                                    <Tag className="w-4 h-4 text-muted-foreground" />
                                                    <code className="font-mono font-bold">{coupon.code}</code>
                                                </div>
                                                {coupon.description && (
                                                    <p className="text-xs text-muted-foreground mt-0.5">{coupon.description}</p>
                                                )}
                                                {/* Where the offer runs, on the
                                                    row, because an operator
                                                    scanning the list for the
                                                    code that is not working
                                                    needs to see that it only
                                                    ever covered one shelf. */}
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    {t("adm_couponScope")}:{" "}
                                                    {(coupon.productIds?.length ?? 0) + (coupon.categoryIds?.length ?? 0) === 0
                                                        ? t("adm_couponScopeEverything")
                                                        : t("adm_couponScopeCount", {
                                                            products: coupon.productIds?.length ?? 0,
                                                            categories: coupon.categoryIds?.length ?? 0,
                                                        })}
                                                </p>
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className="font-medium">
                                                    {coupon.type === "PERCENTAGE"
                                                        ? `${coupon.value}%`
                                                        : money(Number(coupon.value))}
                                                </span>
                                                {coupon.minPurchase && (
                                                    <p className="text-xs text-muted-foreground">
                                                        {/* The field's label names the setting; this line
                                                            states it. One key did both, so the list said
                                                            "Min. purchase" and never the number. */}
                                                        {t("adm_minPurchaseIs", { amount: money(Number(coupon.minPurchase)) })}
                                                    </p>
                                                )}
                                            </td>
                                            <td className="py-3 px-4 text-sm">
                                                {coupon.usageCount} / {coupon.usageLimit || "∞"}
                                            </td>
                                            <td className="py-3 px-4 text-sm text-muted-foreground">
                                                {coupon.expiresAt
                                                    ? formatDate(coupon.expiresAt)
                                                    : t("adm_never")}
                                            </td>
                                            <td className="py-3 px-4">
                                                {/* What an operator opens this
                                                    list to see is which codes
                                                    work today, and the column
                                                    alone does not answer that:
                                                    a coupon past its end date,
                                                    or one that has been used
                                                    up, is switched on and
                                                    unusable. `couponStanding`
                                                    asks the same four
                                                    questions the basket does. */}
                                                {(() => {
                                                    const standing = couponStanding(coupon);
                                                    return <Badge tone={STANDING_TONE[standing]}>{t(`adm_couponStanding_${standing}`)}</Badge>;
                                                })()}
                                            </td>
                                            <td className="py-3 px-4 text-right">
                                                {/* The status used to be a
                                                    `<button>` dressed as a
                                                    badge - the same shape the
                                                    rest of the site uses for
                                                    something you cannot press.
                                                    Switching a coupon on and
                                                    off is an action, so it
                                                    sits with the actions. */}
                                                <RowActions
                                                    actions={[
                                                        {
                                                            icon: coupon.isActive ? ToggleRight : ToggleLeft,
                                                            label: coupon.isActive ? t("adm_couponTurnOff") : t("adm_couponTurnOn"),
                                                            onClick: () => toggleActive(coupon),
                                                        },
                                                        { icon: Pencil, label: commonT("edit"), onClick: () => openForm(coupon.id) },
                                                        {
                                                            icon: Trash2,
                                                            label: commonT("delete"),
                                                            onClick: () => deleteCoupon(coupon.id),
                                                            destructive: true,
                                                        },
                                                    ]}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        </>
                    )}
                    <Pagination page={list.page} pages={list.pages} total={list.total} onPageChange={list.setPage} />
                </CardContent>
            </Card>
        </>
    );
}
