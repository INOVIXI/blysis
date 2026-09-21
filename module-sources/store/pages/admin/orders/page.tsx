"use client";


import { useTranslations, useLocale } from "next-intl";
import { useState, useEffect } from "react";
import { Link } from "@/core/sdk/navigation";
import { formatDate } from "@/core/sdk";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ListControls, Pagination, buttonClassName, useFormRoute, useSiteCurrency } from "@/core/sdk/ui";
import { Loader2, Plus, ShoppingCart } from "lucide-react";
import { dateLocaleTag } from "@/core/sdk";
import { adminOrderStatusKeys, orderStatusLabel, orderStatusTone } from "../../../lib/order-status";
import { AdminPageHeader, FilterChips } from "@/core/sdk/admin";
import { NewOrderForm } from "./NewOrderForm";

/** The admin catalogue's copy of the order status labels. */
const ADMIN_ORDER_STATUS_KEYS = adminOrderStatusKeys("adm_orderStatus_");

interface Order {
    id: string;
    orderNumber: string;
    status: string;
    total: number;
    createdAt: string;
    /*
     * Nullable, because an order can have no account behind it: an operator
     * enters one for a sale that happened elsewhere, and a member who deletes
     * their account does not undo the money. This said it was always there,
     * so nothing complained about the unguarded read below and the screen
     * threw on the first such row - twelve of forty-eight on the demo data.
     */
    user: { id: string; username: string; email: string } | null;
    items: { id: string }[];
}

const statuses = ["ALL", "PENDING", "PROCESSING", "COMPLETED", "CANCELLED", "REFUNDED"];

export default function AdminOrdersPage() {
    const { format: money } = useSiteCurrency();
    const t = useTranslations("store");
    const dateTag = dateLocaleTag(useLocale());
    const { showForm, formHref, closeForm } = useFormRoute();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeStatus, setActiveStatus] = useState("ALL");
    /*
     * How many orders are in each status, from the endpoint.
     *
     * This screen used to count the ten rows it had and print that beside
     * each tab, and it filtered by status over those same ten. So a shop with
     * four hundred orders and two refunds showed nothing at all under
     * "Refunded" unless both happened to be among the newest ten - which is
     * worse than no filter: it says the refund never happened.
     */
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [page, setPage] = useState(1);
    // The endpoint has taken `q` since it was written and this screen never
    // sent one, so the only way to an order was to page to it.
    const [search, setSearch] = useState("");
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);

    const fetchOrders = async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams({ page: String(page), limit: "20" });
            if (search.trim()) query.set("q", search.trim());
            if (activeStatus !== "ALL") query.set("status", activeStatus);
            const res = await fetch(`/api/v1/store/orders?${query}`);
            if (res.ok) {
                const data = await res.json();
                setOrders(data.orders || []);
                setCounts(data.counts || {});
                setTotal(data.pagination?.total || 0);
                setTotalPages(data.pagination?.pages || 1);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOrders();
    }, [page, search, activeStatus]);  // eslint-disable-line react-hooks/exhaustive-deps

    if (showForm) {
        return (
            <NewOrderForm
                onCancel={closeForm}
                onDone={() => {
                    closeForm();
                    setPage(1);
                    fetchOrders();
                }}
            />
        );
    }

    return (
        <>
            <AdminPageHeader
                title={t("adm_orders")}
                description={t("adm_ordersTotal", { count: total })}
                actions={
                    <Link href={formHref()} className={buttonClassName("default", "default")}>
                        <Plus className="h-4 w-4" aria-hidden="true" /> {t("adm_manualOrderNew")}
                    </Link>
                }
            />

            <ListControls
                className="mb-4"
                search={{ value: search, onChange: (term) => { setSearch(term); setPage(1); } }}
            />

            {/* The counts come from the endpoint, not from the page in the
                browser: this screen used to count the ten rows it had. A kind
                with none waiting keeps its zero so the strip does not change
                width as orders arrive. */}
            <FilterChips
                className="mb-6"
                label={t("adm_status")}
                active={activeStatus}
                onSelect={(status) => { setActiveStatus(status); setPage(1); }}
                chips={statuses.map((status) => (
                    status === "ALL"
                        ? { id: status, label: t("adm_all") }
                        : { id: status, label: t(`adm_orderStatus_${status}`), count: counts[status] || 0 }
                ))}
            />

            <Card>
                <CardHeader>
                    <CardTitle>
                        {activeStatus === "ALL" ? t("adm_allOrders") : t("adm_statusOrders", { status: activeStatus })}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : orders.length === 0 ? (
                        <div className="text-center py-12">
                            <ShoppingCart className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
                            <p className="text-muted-foreground">{t("adm_noOrdersFound")}</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_orderNumber", { number: "" }).trim()}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_customer")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_date")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_items")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_total")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_status")}</th>
                                        <th className="text-right py-3 px-4 font-medium text-muted-foreground">{t("adm_actions")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {orders.map((order) => (
                                        <tr key={order.id} className="hover:bg-muted/50">
                                            <td className="py-3 px-4">
                                                <p className="font-medium">{order.orderNumber}</p>
                                            </td>
                                            <td className="py-3 px-4">
                                                <p>{order.user?.username ?? t("adm_noAccount")}</p>
                                                <p className="text-xs text-muted-foreground">{order.user?.email ?? ""}</p>
                                            </td>
                                            <td className="py-3 px-4 text-muted-foreground">
                                                {formatDate(new Date(order.createdAt), undefined, dateTag)}
                                            </td>
                                            <td className="py-3 px-4 text-muted-foreground">
                                                {t("adm_itemsCount", { count: order.items.length })}
                                            </td>
                                            <td className="py-3 px-4 font-medium">
                                                {money(Number(order.total))}
                                            </td>
                                            <td className="py-3 px-4">
                                                <Badge tone={orderStatusTone(order.status)}>
                                                    {orderStatusLabel(t, ADMIN_ORDER_STATUS_KEYS, order.status)}
                                                </Badge>
                                            </td>
                                            <td className="py-3 px-4 text-right">
                                                <Link href={`/admin/store/orders/${order.id}`} className={buttonClassName("ghost", "sm")}>{t("adm_view")}</Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <Pagination page={page} pages={totalPages} onPageChange={setPage} />
                </CardContent>
            </Card>
        </>
    );
}
