"use client";

/**
 * Every voucher made in game: how much, who paid for it or which server
 * minted it, and who redeemed it. Only the end of each id is shown, because
 * the id is the whole voucher.
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Badge, Card, CardContent, ListControls, Pagination, useLocalDateTime } from "@/core/sdk/ui";
import { AdminPageHeader, FilterChips } from "@/core/sdk/admin";

interface Voucher {
    hint: string;
    amount: number;
    origin: string;
    createdBy: string | null;
    createdOnServer: string | null;
    redeemedBy: string | null;
    redeemedAt: string | null;
    createdAt: string;
}

const FILTERS = ["all", "open", "redeemed"] as const;

export default function VouchersPage() {
    const t = useTranslations("gameConnect");
    const when = useLocalDateTime();
    const [filter, setFilter] = useState<string>("all");
    const [vouchers, setVouchers] = useState<Voucher[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");

    const load = useCallback(async () => {
        const query = new URLSearchParams({ page: String(page) });
        if (search.trim()) query.set("q", search.trim());
        if (filter !== "all") query.set("state", filter);
        const res = await fetch(`/api/v1/game-connect/admin/vouchers?${query}`);
        if (res.ok) {
            const data = await res.json();
            setVouchers(data.vouchers ?? []);
            setPages(Math.max(1, Math.ceil((data.total ?? 0) / (data.limit ?? 50))));
        } else toast.error(t("v_loadFailed"));
        setLoading(false);
    }, [page, filter, search, t]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, [load]);

    return (
        <>
            <AdminPageHeader title={t("v_title")} description={t("v_subtitle")} />
            <FilterChips
                className="mb-4"
                label={t("v_filter")}
                active={filter}
                onSelect={(next) => { setFilter(next); setPage(1); }}
                chips={FILTERS.map((id) => ({ id, label: t(`v_filter_${id}`) }))}
            />
            <ListControls className="mb-4" search={{ value: search, onChange: (term) => { setSearch(term); setPage(1); } }} />
            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : vouchers.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">{t("v_empty")}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("v_id")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("v_amount")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("v_madeBy")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("v_redeemedBy")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {vouchers.map((voucher) => (
                                        <tr key={voucher.hint + voucher.createdAt} className="border-b last:border-0 hover:bg-muted/50">
                                            <td className="py-3 px-4">
                                                <code className="font-mono text-sm">…{voucher.hint}</code>
                                                <p className="text-xs text-muted-foreground">{when(voucher.createdAt)}</p>
                                            </td>
                                            <td className="py-3 px-4 font-medium">{t("v_credits", { amount: voucher.amount })}</td>
                                            <td className="py-3 px-4 text-sm">
                                                {voucher.origin === "admin"
                                                    ? <Badge tone="info">{t("v_minted")}</Badge>
                                                    : (voucher.createdBy ?? "-")}
                                            </td>
                                            <td className="py-3 px-4 text-sm">
                                                {voucher.redeemedAt
                                                    ? <>{voucher.redeemedBy ?? "-"}<p className="text-xs text-muted-foreground">{when(voucher.redeemedAt)}</p></>
                                                    : <Badge tone="success">{t("v_open")}</Badge>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <Pagination page={page} pages={pages} onPageChange={setPage} />
                </CardContent>
            </Card>
        </>
    );
}
