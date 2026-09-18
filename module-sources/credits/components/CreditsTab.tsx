"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle, LoadFailed, Pagination, useLocalDate } from "@/core/sdk/ui";
import {
    ArrowDownLeft,
    ArrowUpRight,
    Coins,
    Gift,
    Loader2,
    Send,
    ShoppingBag,
    Sparkles,
    UserPlus,
    Wallet,
} from "lucide-react";
import { labelKeyFor } from "../lib/ledger-types";
import { CreditPackages } from "./CreditPackages";
import { SendCredits } from "./SendCredits";

interface Transaction {
    id: string;
    amount: string | number;
    type: string;
    description: string | null;
    createdAt: string;
}

interface Page {
    page: number;
    pages: number;
    total: number;
}

/** Rows per page. The endpoint's default; named here because the pager shows it. */
const PER_PAGE = 10;

/**
 * The face of a ledger row.
 *
 * The history was a stack of rows with a bare 16-pixel glyph at the left and a
 * hairline between them, which at a glance was a wall of grey text with a
 * black rule through it - the rules were `divide-y` with no colour, so they
 * drew in the text colour. A ledger is read by scanning down the right-hand
 * column for a number and left for what it was; the badge is what makes that
 * scan possible, and it is the same shape the activity feed and the trophy
 * case already use.
 *
 * Keyed on the ledger's own words rather than on the sign, because "spent"
 * and "sent" are both money leaving and they are not the same event.
 */
const FACE: Record<string, { icon: typeof Coins; tone: string }> = {
    credit_purchase: { icon: Wallet, tone: "bg-primary/10 text-primary" },
    purchase: { icon: ShoppingBag, tone: "bg-destructive/10 text-destructive" },
    market_purchase: { icon: ShoppingBag, tone: "bg-destructive/10 text-destructive" },
    market_sale: { icon: Coins, tone: "bg-success/10 text-success" },
    market_commission: { icon: Coins, tone: "bg-success/10 text-success" },
    creator_commission: { icon: Coins, tone: "bg-success/10 text-success" },
    transfer_out: { icon: Send, tone: "bg-accent/10 text-accent" },
    transfer: { icon: Send, tone: "bg-accent/10 text-accent" },
    transfer_in: { icon: ArrowDownLeft, tone: "bg-accent/10 text-accent" },
    cashback: { icon: ArrowDownLeft, tone: "bg-success/10 text-success" },
    referral_reward: { icon: UserPlus, tone: "bg-success/10 text-success" },
    wheel_prize: { icon: Sparkles, tone: "bg-warning/10 text-warning" },
    wheel_spin: { icon: Sparkles, tone: "bg-destructive/10 text-destructive" },
    gift_redeem: { icon: Gift, tone: "bg-success/10 text-success" },
    admin_grant: { icon: Coins, tone: "bg-primary/10 text-primary" },
    debit: { icon: ArrowUpRight, tone: "bg-destructive/10 text-destructive" },
    spend: { icon: ArrowUpRight, tone: "bg-destructive/10 text-destructive" },
};

/** A word this catalogue has never seen still gets a face, from its sign. */
function faceFor(type: string, amount: number) {
    return FACE[type] ?? (amount < 0
        ? { icon: ArrowUpRight, tone: "bg-destructive/10 text-destructive" }
        : { icon: ArrowDownLeft, tone: "bg-success/10 text-success" });
}

export default function CreditsTab() {
    const t = useTranslations("credits");
    const __locale = useLocale();
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const [balance, setBalance] = useState<number>(0);
    const [history, setHistory] = useState<Transaction[]>([]);
    const [paging, setPaging] = useState<Page>({ page: 1, pages: 1, total: 0 });
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/v1/credits?page=${page}&limit=${PER_PAGE}`)
            .then(r => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then(d => { if (cancelled) return;
                setBalance(Number(d.balance || 0));
                setHistory(Array.isArray(d.history) ? d.history : []);
                setPaging(d.pagination ?? { page: 1, pages: 1, total: 0 });
                setFailed(false);
            })
            .catch(() => { if (cancelled) return; setFailed(true); })
            .finally(() => { if (cancelled) return; setLoading(false); });
        return () => { cancelled = true; };
    }, [reloadKey, page]);

    // The rule lives beside the catalogue it has to agree with; a gate holds
    // the two together for every word written as a literal, and `labelKeyFor`
    // covers the rest - the award door takes a reason from whoever calls it,
    // and a missing key renders as the key itself.
    const typeLabel = (type: string) => t(labelKeyFor(type, (key) => t.has(key)));

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">{t("balance")}</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Coins className="h-5 w-5" aria-hidden="true" />
                    </span>
                    {loading ? (
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    ) : (
                        <p className="text-3xl font-bold tabular-nums">{balance.toFixed(2)}</p>
                    )}
                </CardContent>
            </Card>

            <CreditPackages onBought={() => setReloadKey((k) => k + 1)} />

            <SendCredits balance={balance} onSent={() => setReloadKey((k) => k + 1)} />

            <Card>
                <CardHeader>
                    <CardTitle>{t("history")}</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-6">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : failed ? (
                        <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
                    ) : history.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">{t("noTransactions")}</p>
                    ) : (
                        <>
                            <ul className="-my-1">
                                {history.map(tx => {
                                    const amount = Number(tx.amount);
                                    const isNegative = amount < 0;
                                    const face = faceFor(tx.type, amount);
                                    const Icon = face.icon;
                                    return (
                                        <li
                                            key={tx.id}
                                            className="flex items-center gap-3 border-b border-border py-3 last:border-0"
                                        >
                                            <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${face.tone}`}>
                                                <Icon className="h-4 w-4" aria-hidden="true" />
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium text-foreground">{typeLabel(tx.type)}</p>
                                                <p className="truncate text-xs text-muted-foreground">
                                                    {tx.description
                                                        ? `${tx.description} · ${formatDate(tx.createdAt)}`
                                                        : formatDate(tx.createdAt)}
                                                </p>
                                            </div>
                                            {/* Tabular figures, so the column of numbers lines up
                                                on the decimal point the way a ledger is read. */}
                                            <p className={`flex-shrink-0 text-sm font-semibold tabular-nums ${isNegative ? "text-destructive" : "text-success"}`}>
                                                {isNegative ? "" : "+"}{amount.toFixed(2)}
                                            </p>
                                        </li>
                                    );
                                })}
                            </ul>
                            <Pagination
                                page={paging.page}
                                pages={paging.pages}
                                total={paging.total}
                                onPageChange={setPage}
                            />
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
