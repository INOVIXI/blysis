"use client";

/**
 * Every credit top-up a buyer started: who, through which gateway, what it
 * cost and how many credits it gave, bonus included, and whether it was
 * paid, abandoned or refunded.
 */
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { dateLocaleTag, formatCurrency } from "@/core/sdk";
import { Badge, Card, CardContent, ListControls, Pagination, useLocalDateTime, type BadgeTone } from "@/core/sdk/ui";
import { AdminPageHeader, FilterChips } from "@/core/sdk/admin";

interface TopUpRow {
    id: string;
    credits: number;
    bonusCredits: number;
    amount: number;
    fee: number;
    currency: string;
    provider: string;
    providerRef: string | null;
    status: "PENDING" | "COMPLETED" | "CANCELLED";
    refundedAt: string | null;
    createdAt: string;
    user: { id: string; username: string } | null;
}

const FILTERS = ["all", "PENDING", "COMPLETED", "CANCELLED", "REFUNDED"] as const;

/** A refunded top-up stays COMPLETED in its column; what an operator needs to read is that the money went back. */
function standingOf(row: TopUpRow): (typeof FILTERS)[number] {
    return row.refundedAt ? "REFUNDED" : row.status;
}

const TONE: Record<string, BadgeTone> = {
    PENDING: "warning",
    COMPLETED: "success",
    CANCELLED: "neutral",
    REFUNDED: "danger",
};

export default function CreditTopUpsPage() {
    const t = useTranslations("store");
    const dateTag = dateLocaleTag(useLocale());
    const when = useLocalDateTime();
    const [status, setStatus] = useState<string>("all");
    const [provider, setProvider] = useState("");
    const [search, setSearch] = useState("");
    const [rows, setRows] = useState<TopUpRow[]>([]);
    const [providers, setProviders] = useState<string[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        const query = new URLSearchParams({ page: String(page) });
        if (status !== "all") query.set("status", status);
        if (provider) query.set("provider", provider);
        if (search.trim()) query.set("q", search.trim());
        try {
            const res = await fetch(`/api/v1/store/admin/credit-top-ups?${query}`);
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setRows(data.topUps ?? []);
            setProviders(data.providers ?? []);
            setTotal(data.total ?? 0);
            setPages(Math.max(1, Math.ceil((data.total ?? 0) / (data.limit ?? 25))));
        } catch {
            toast.error(t("tup_loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [page, status, provider, search, t]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, [load]);

    return (
        <>
            <AdminPageHeader title={t("tup_title")} description={t("tup_subtitle")} />
            <FilterChips
                className="mb-4"
                label={t("tup_status")}
                active={status}
                onSelect={(next) => { setStatus(next); setPage(1); }}
                chips={FILTERS.map((id) => ({ id, label: t(`tup_status_${id}`) }))}
            />
            <ListControls
                className="mb-4"
                search={{ value: search, onChange: (term) => { setSearch(term); setPage(1); }, placeholder: t("tup_search") }}
                filters={[
                    {
                        id: "provider",
                        label: t("tup_gateway"),
                        value: provider,
                        options: [
                            { value: "", label: t("tup_everyGateway") },
                            ...providers.map((id) => ({ value: id, label: id })),
                        ],
                        onChange: (next) => { setProvider(next); setPage(1); },
                    },
                ]}
            />
            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : rows.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">{t("tup_empty")}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("tup_started")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("tup_buyer")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("tup_gateway")}</th>
                                        <th className="text-right py-3 px-4 font-medium text-muted-foreground text-sm">{t("tup_paid")}</th>
                                        <th className="text-right py-3 px-4 font-medium text-muted-foreground text-sm">{t("tup_credits")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("tup_status")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => {
                                        const standing = standingOf(row);
                                        return (
                                            <tr key={row.id} className="border-b last:border-0 hover:bg-muted/50">
                                                <td className="py-3 px-4 text-sm text-muted-foreground whitespace-nowrap">{when(row.createdAt)}</td>
                                                <td className="py-3 px-4 text-sm">{row.user?.username ?? t("tup_noAccount")}</td>
                                                <td className="py-3 px-4 text-sm">
                                                    {row.provider}
                                                    {row.providerRef && (
                                                        <p className="text-xs text-muted-foreground font-mono break-all">{row.providerRef}</p>
                                                    )}
                                                </td>
                                                <td className="py-3 px-4 text-sm text-right tabular-nums">
                                                    {formatCurrency(row.amount + row.fee, row.currency, dateTag)}
                                                    {row.fee > 0 && (
                                                        <p className="text-xs text-muted-foreground">
                                                            {t("tup_feeIncluded", { fee: formatCurrency(row.fee, row.currency, dateTag) })}
                                                        </p>
                                                    )}
                                                </td>
                                                <td className="py-3 px-4 text-sm text-right tabular-nums font-medium">
                                                    {row.credits}
                                                    {row.bonusCredits > 0 && (
                                                        <p className="text-xs text-success">{t("tup_bonus", { count: row.bonusCredits })}</p>
                                                    )}
                                                </td>
                                                <td className="py-3 px-4">
                                                    <Badge tone={TONE[standing]}>{t(`tup_status_${standing}`)}</Badge>
                                                </td>
                                            </tr>
                                        );
                                    })}
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
