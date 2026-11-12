"use client";

/**
 * Who used which coupon, and how often: one row per coupon and customer.
 *
 * Opened from a coupon's row to answer "why was this player refused the
 * code", or on its own to see which codes are being used and by whom.
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, ListControls, Pagination, useLocalDateTime } from "@/core/sdk/ui";
import { AdminPageHeader } from "@/core/sdk/admin";
import { useRouter } from "@/core/sdk/navigation";

interface CouponUseRow {
    couponId: string;
    code: string | null;
    perCustomerLimit: number | null;
    userId: string | null;
    username: string | null;
    held: number;
    waiting: number;
    returned: number;
    lastUsedAt: string | null;
}

interface CouponOption {
    id: string;
    code: string;
}

export default function CouponUsesPage() {
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const when = useLocalDateTime();
    const router = useRouter();
    // The coupon a row's link names, so the screen opens on that code.
    const [coupon, setCoupon] = useState(useSearchParams().get("coupon") ?? "");
    const [coupons, setCoupons] = useState<CouponOption[]>([]);
    const [rows, setRows] = useState<CouponUseRow[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("/api/v1/store/coupons")
            .then((res) => (res.ok ? res.json() : { coupons: [] }))
            .then((data: { coupons?: CouponOption[] }) => setCoupons(data.coupons ?? []))
            .catch(() => setCoupons([]));
    }, []);

    const load = useCallback(async () => {
        const query = new URLSearchParams({ page: String(page) });
        if (coupon) query.set("coupon", coupon);
        if (search.trim()) query.set("q", search.trim());
        try {
            const res = await fetch(`/api/v1/store/admin/coupon-uses?${query}`);
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setRows(data.uses ?? []);
            setTotal(data.total ?? 0);
            setPages(Math.max(1, Math.ceil((data.total ?? 0) / (data.limit ?? 25))));
        } catch {
            toast.error(t("cuse_loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [page, coupon, search, t]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, [load]);

    return (
        <>
            <AdminPageHeader
                title={t("cuse_title")}
                description={t("cuse_subtitle")}
                onBack={() => router.push("/admin/store/coupons")}
                backLabel={commonT("back")}
            />
            <ListControls
                className="mb-4"
                search={{ value: search, onChange: (term) => { setSearch(term); setPage(1); }, placeholder: t("cuse_search") }}
                filters={[
                    {
                        id: "coupon",
                        label: t("cuse_coupon"),
                        value: coupon,
                        options: [
                            { value: "", label: t("cuse_everyCoupon") },
                            ...coupons.map((option) => ({ value: option.id, label: option.code })),
                        ],
                        onChange: (next) => { setCoupon(next); setPage(1); },
                    },
                ]}
            />
            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : rows.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">{t("cuse_empty")}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("cuse_customer")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("cuse_coupon")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("cuse_held")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("cuse_waiting")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("cuse_returned")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("cuse_lastUsed")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => (
                                        <tr key={`${row.couponId}:${row.userId ?? ""}`} className="border-b last:border-0 hover:bg-muted/50">
                                            <td className="py-3 px-4 text-sm">{row.username ?? t("cuse_noAccount")}</td>
                                            <td className="py-3 px-4">
                                                <code className="font-mono text-sm">{row.code ?? t("cuse_deletedCoupon")}</code>
                                            </td>
                                            <td className="py-3 px-4 text-sm font-medium">
                                                {row.perCustomerLimit
                                                    ? t("cuse_heldOfLimit", { held: row.held, limit: row.perCustomerLimit })
                                                    : row.held}
                                            </td>
                                            <td className="py-3 px-4 text-sm">{row.waiting}</td>
                                            <td className="py-3 px-4 text-sm">{row.returned}</td>
                                            <td className="py-3 px-4 text-sm text-muted-foreground">
                                                {row.lastUsedAt ? when(row.lastUsedAt) : "-"}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />
                </CardContent>
            </Card>
        </>
    );
}
