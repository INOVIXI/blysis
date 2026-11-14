"use client";

/**
 * Every credit that moved on the site, newest first: what was spent, bought,
 * won, sent and changed by hand. Narrowed by member, by kind of row and by
 * which way the credits went.
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { cn } from "@/core/sdk";
import { Card, CardContent, ListControls, Pagination, buttonClassName, useLocalDateTime } from "@/core/sdk/ui";
import { AdminPageHeader, FilterChips, UserPicker, type PickedUser } from "@/core/sdk/admin";
import { Link } from "@/core/sdk/navigation";
import { labelKeyFor } from "../../../lib/ledger-types";

interface LedgerEntry {
    id: string;
    amount: number;
    type: string;
    description: string | null;
    createdAt: string;
    user: { id: string; username: string } | null;
}

const DIRECTIONS = ["all", "in", "out"] as const;

export default function CreditLedgerPage() {
    const t = useTranslations("credits");
    const when = useLocalDateTime();
    const [member, setMember] = useState<PickedUser | null>(null);
    const [type, setType] = useState("");
    const [direction, setDirection] = useState<string>("all");
    const [entries, setEntries] = useState<LedgerEntry[]>([]);
    const [types, setTypes] = useState<string[]>([]);
    const [balance, setBalance] = useState<number | null>(null);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);

    const typeLabel = (word: string) => t(labelKeyFor(word, (key) => t.has(key)));

    const load = useCallback(async () => {
        const query = new URLSearchParams({ page: String(page) });
        if (member) query.set("userId", member.id);
        if (type) query.set("type", type);
        if (direction !== "all") query.set("direction", direction);
        try {
            const res = await fetch(`/api/v1/credits/admin/ledger?${query}`);
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setEntries(data.entries ?? []);
            setTypes(data.types ?? []);
            setBalance(data.balance ?? null);
            setTotal(data.total ?? 0);
            setPages(Math.max(1, Math.ceil((data.total ?? 0) / (data.limit ?? 25))));
        } catch {
            toast.error(t("led_loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [page, member, type, direction, t]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, [load]);

    return (
        <>
            <AdminPageHeader
                title={t("led_title")}
                description={t("led_subtitle")}
                actions={
                    <Link href="/admin/credits/adjust" className={buttonClassName("default", "default")}>
                        <SlidersHorizontal className="w-4 h-4" /> {t("adj_title")}
                    </Link>
                }
            />
            <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <UserPicker
                    id="ledger-member"
                    label={t("led_member")}
                    value={member}
                    onChange={(next) => { setMember(next); setPage(1); }}
                />
                <ListControls
                    filters={[
                        {
                            id: "type",
                            label: t("led_type"),
                            value: type,
                            options: [
                                { value: "", label: t("led_everyType") },
                                ...types.map((word) => ({ value: word, label: typeLabel(word) })),
                            ],
                            onChange: (next) => { setType(next); setPage(1); },
                        },
                    ]}
                />
            </div>
            <FilterChips
                className="mb-4"
                label={t("led_direction")}
                active={direction}
                onSelect={(next) => { setDirection(next); setPage(1); }}
                chips={DIRECTIONS.map((id) => ({ id, label: t(`led_direction_${id}`) }))}
            />
            {member && balance !== null && (
                <p role="status" className="mb-4 text-sm text-muted-foreground">
                    {t("led_balanceOf", { name: member.username, balance })}
                </p>
            )}
            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : entries.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">{t("noTransactions")}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("led_when")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("led_member")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("led_type")}</th>
                                        <th className="text-right py-3 px-4 font-medium text-muted-foreground text-sm">{t("amount")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {entries.map((entry) => (
                                        <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/50">
                                            <td className="py-3 px-4 text-sm text-muted-foreground whitespace-nowrap">{when(entry.createdAt)}</td>
                                            <td className="py-3 px-4 text-sm">{entry.user?.username ?? t("led_nobody")}</td>
                                            <td className="py-3 px-4 text-sm">
                                                {typeLabel(entry.type)}
                                                {entry.description && (
                                                    <p className="text-xs text-muted-foreground">{entry.description}</p>
                                                )}
                                            </td>
                                            <td
                                                className={cn(
                                                    "py-3 px-4 text-sm text-right font-medium tabular-nums",
                                                    entry.amount > 0 ? "text-success" : "text-destructive",
                                                )}
                                            >
                                                {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
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
