"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback } from "react";
import { Button, Card, CardContent, Input, Label, ListControls, Pagination, useConfirm, useFormRoute, useRowList, useSiteCurrency, NativeSelect, buttonClassName, useLocalDate } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import { ArrowLeft, Loader2, Plus, Trash2, Tag } from "lucide-react";
import { toast } from "sonner";
import { writeError } from "@/core/sdk";
import { AdminPageHeader } from "@/core/sdk/admin";
import { errorMessage } from "@/core/sdk";

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
        expiresAt: "",
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
            setForm({ code: "", description: "", type: "PERCENTAGE", value: "", minPurchase: "", maxDiscount: "", usageLimit: "", expiresAt: "", isActive: true });
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
            expiresAt: coupon.expiresAt ? new Date(coupon.expiresAt).toISOString().slice(0, 16) : "",
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
                    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
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

                            <div>
                                <Label>{t("adm_expiresAt")}</Label>
                                <Input
                                    aria-label={t("adm_expiresAt")}
                                    type="datetime-local"
                                    value={form.expiresAt}
                                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                                />
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
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b">
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
                                                <div className="flex items-center gap-2">
                                                    <Tag className="w-4 h-4 text-muted-foreground" />
                                                    <code className="font-mono font-bold">{coupon.code}</code>
                                                </div>
                                                {coupon.description && (
                                                    <p className="text-xs text-muted-foreground mt-0.5">{coupon.description}</p>
                                                )}
                                            </td>
                                            <td className="py-3 px-4">
                                                <span className="font-medium">
                                                    {coupon.type === "PERCENTAGE"
                                                        ? `${coupon.value}%`
                                                        : money(Number(coupon.value))}
                                                </span>
                                                {coupon.minPurchase && (
                                                    <p className="text-xs text-muted-foreground">
                                                        {t("adm_minPurchase", { amount: money(Number(coupon.minPurchase)) })}
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
                                                <button
                                                    onClick={() => toggleActive(coupon)}
                                                    className={`text-xs px-2 py-1 rounded cursor-pointer ${coupon.isActive
                                                        ? "bg-success/10 text-success"
                                                        : "bg-muted text-muted-foreground"
                                                    }`}
                                                >
                                                    {coupon.isActive ? t("adm_active") : t("adm_inactive")}
                                                </button>
                                            </td>
                                            <td className="py-3 px-4 text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openForm(coupon.id)}
                                                >
                                                    {t("adm_edit")}
                                                </Button>
                                                <Button
                                                    aria-label={commonT("delete")}
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-destructive"
                                                    onClick={() => deleteCoupon(coupon.id)}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <Pagination page={list.page} pages={list.pages} total={list.total} onPageChange={list.setPage} />
                </CardContent>
            </Card>
        </>
    );
}
