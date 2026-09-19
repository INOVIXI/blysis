"use client";

import { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import { useTranslations, useLocale } from "next-intl";
import { formatDate } from "@/core/sdk";
import { Link } from "@/core/sdk/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, ListControls, LoadFailed, Pagination, useSiteCurrency, buttonClassName } from "@/core/sdk/ui";
import { ChevronDown, ChevronUp, Package, Receipt, ShoppingCart, Loader2 } from "lucide-react";
import { dateLocaleTag } from "@/core/sdk";
import { ORDER_STATUSES, ORDER_STATUS_KEYS, orderStatusLabel } from "../lib/order-status";

interface Order {
    id: string;
    orderNumber: string;
    subtotal: number;
    discount: number;
    total: number;
    status: string;
    createdAt: string;
    items: {
        id: string;
        name: string;
        price: number;
        quantity: number;
        product: { id: string; name: string; image: string | null } | null;
    }[];
}

interface Page {
    page: number;
    pages: number;
    total: number;
}

/** Orders per page. */
const PER_PAGE = 10;

const statusColor = (status: string) => {
    switch (status) {
        case "COMPLETED": return "bg-success/10 text-success";
        case "PENDING": return "bg-warning/10 text-warning";
        case "PROCESSING": return "bg-primary/10 text-primary";
        case "CANCELLED": return "bg-destructive/10 text-destructive";
        default: return "bg-muted text-foreground";
    }
};

export function ProfileOrdersTab() {
    const { format: money } = useSiteCurrency();
    const t = useTranslations("store");
    const dateTag = dateLocaleTag(useLocale());
    const [orders, setOrders] = useState<Order[]>([]);
    const [paging, setPaging] = useState<Page>({ page: 1, pages: 1, total: 0 });
    const [term, setTerm] = useState("");
    const [status, setStatus] = useState("");
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

    const statusLabel = (status: string) => orderStatusLabel(t, ORDER_STATUS_KEYS, status);

    // The endpoint has always paged; this screen asked for ten and drew ten,
    // so a customer with a history had no way past their last ten purchases
    // and no way to find the one they opened a ticket about.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        const query = new URLSearchParams({ limit: String(PER_PAGE), page: String(page) });
        if (term) query.set("q", term);
        if (status) query.set("status", status);
        fetch(`/api/v1/store/orders?${query}`)
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then(data => {
                if (cancelled) return;
                setOrders(data.orders || []);
                setPaging(data.pagination ?? { page: 1, pages: 1, total: 0 });
                setFailed(false);
            })
            .catch(() => { if (cancelled) return; setFailed(true); })
            .finally(() => { if (cancelled) return; setLoading(false); });
        return () => { cancelled = true; };
    }, [reloadKey, page, term, status]);

    const statusOptions = useMemo(
        () => [
            { value: "", label: t("tab_orders_allStatuses") },
            ...ORDER_STATUSES.map((value) => ({ value, label: statusLabel(value) })),
        ],
        // `statusLabel` closes over `t`, which is stable for a locale.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t],
    );

    const filtering = term !== "" || status !== "";

    if (loading) {
        return (
            <Card>
                <CardContent className="p-8 text-center">
                    {/* The site's spinner. This was a div with a spinning border
                        whose top edge was a hardcoded grey, so on a dark theme it
                        span a light ring against a dark one. */}
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("tab_orders_title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <ListControls
                    search={{
                        value: term,
                        onChange: (value) => { setPage(1); setTerm(value); },
                        placeholder: t("tab_orders_search"),
                    }}
                    filters={[{
                        id: "status",
                        label: t("tab_orders_status"),
                        value: status,
                        options: statusOptions,
                        onChange: (value) => { setPage(1); setStatus(value); },
                    }]}
                />
                {failed ? (
                    <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
                ) : orders.length === 0 && filtering ? (
                    <p className="text-center text-muted-foreground py-8">{t("tab_orders_noMatch")}</p>
                ) : orders.length === 0 ? (
                    <div className="text-center py-8">
                        <ShoppingCart className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                        <p className="text-muted-foreground">{t("tab_orders_empty")}</p>
                        <Link href="/store" className={buttonClassName("outline", "default", "mt-3")}>{t("tab_orders_browse")}</Link>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {orders.map((order) => (
                            <div key={order.id}>
                                <button
                                    onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                                    className="w-full flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                                >
                                    <div className="text-left">
                                        <p className="font-medium">{order.orderNumber}</p>
                                        <p className="text-xs text-muted-foreground">{formatDate(new Date(order.createdAt), undefined, dateTag)}</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="text-right">
                                            <p className="font-bold">{money(Number(order.total))}</p>
                                            <span className={`text-xs px-2 py-0.5 rounded ${statusColor(order.status)}`}>
                                                {statusLabel(order.status)}
                                            </span>
                                        </div>
                                        {expandedOrder === order.id
                                            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                            : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                        }
                                    </div>
                                </button>
                                {expandedOrder === order.id && order.items && (
                                    <div className="mt-1 p-4 bg-background border border-border rounded-lg">
                                        <div className="space-y-2">
                                            {order.items.map((item) => (
                                                <div key={item.id} className="flex items-center gap-3">
                                                    <div className="w-10 h-10 bg-muted rounded flex-shrink-0 flex items-center justify-center overflow-hidden">
                                                        {item.product?.image ? (
                                                            <Image src={item.product.image} alt="" width={40} height={40} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <Package className="w-4 h-4 text-muted-foreground" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1">
                                                        <p className="text-sm font-medium">{item.product?.name || item.name}</p>
                                                        <p className="text-xs text-muted-foreground">
                                                            {money(Number(item.price))} × {item.quantity}
                                                        </p>
                                                    </div>
                                                    <p className="text-sm font-medium">
                                                        {money(Number(item.price) * item.quantity)}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                        {Number(order.discount) > 0 && (
                                            <div className="flex justify-between mt-3 pt-3 border-t text-sm text-success">
                                                <span>{t("tab_orders_discount")}</span>
                                                <span>-{money(Number(order.discount))}</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between mt-2 pt-2 border-t text-sm font-bold">
                                            <span>{t("tab_orders_total")}</span>
                                            <span>{money(Number(order.total))}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                {!failed && orders.length > 0 && (
                    <Pagination page={paging.page} pages={paging.pages} total={paging.total} onPageChange={setPage} />
                )}
            </CardContent>
        </Card>
    );
}

export default ProfileOrdersTab;
