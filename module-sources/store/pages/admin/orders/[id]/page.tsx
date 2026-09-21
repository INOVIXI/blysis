import { notFound } from "next/navigation";
import { redirect } from "@/core/sdk/navigation";
import { Link } from "@/core/sdk/navigation";
import Image from "next/image";
import { formatCurrency, formatDate, dateLocaleTag } from "@/core/sdk";
import { isAdmin, prisma, siteCurrency } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/core/sdk/ui";
import { ArrowLeft, Package } from "lucide-react";
import { OrderStatusSelect } from "./status-select";
import { adminOrderStatusKeys, orderStatusLabel } from "../../../../lib/order-status";

/** The admin catalogue's copy of the order status labels. */
const ADMIN_ORDER_STATUS_KEYS = adminOrderStatusKeys("adm_orderStatus_");
import { getTranslations, getLocale } from "next-intl/server";
import { AdminPageHeader } from "@/core/sdk/admin";

export const dynamic = "force-dynamic";

interface PageProps {
    params: Promise<{ id: string }>;
}

export default async function AdminOrderDetailPage({ params }: PageProps) {
    const t = await getTranslations("store");
    const commonT = await getTranslations("common");
    const locale = await getLocale();
    const dateTag = dateLocaleTag(locale);
    // A server render always writes the base currency: the visitor's display
    // choice lives in their browser, and guessing it here would ship one
    // currency in the HTML and another after hydration.
    const currency = await siteCurrency();
    const money = (amount: number) => formatCurrency(amount, currency, dateTag);
    const session = await auth();
    if (!session?.user) redirect({ href: "/auth/login", locale });

    const adminCheck = await isAdmin(session.user.id);
    if (!adminCheck) redirect({ href: "/", locale });

    const { id } = await params;

    const order = await prisma.order.findUnique({
        where: { id },
        include: {
            user: { select: { id: true, username: true, email: true } },
            items: {
                include: {
                    product: { select: { id: true, name: true, slug: true, image: true } },
                },
            },
            payments: true,
        },
    });

    if (!order) notFound();

    return (
        <>
            <AdminPageHeader
                title={t("adm_orderNumber", { number: order.orderNumber })}
                description={formatDate(order.createdAt, undefined, dateTag)}
                backHref="/admin/store/orders"
                backLabel={commonT("back")}
                actions={<>
                    <OrderStatusSelect orderId={order.id} currentStatus={order.status} />
                </>}
            />

            <div className="grid lg:grid-cols-3 gap-8">
                {/* Order Items */}
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("adm_itemsWithCount", { count: order.items.length })}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {order.items.map((item) => (
                                    <div key={item.id} className="flex items-center gap-4 py-3 border-b border-border last:border-0">
                                        <div className="w-12 h-12 bg-muted rounded-lg overflow-hidden flex-shrink-0">
                                            {item.product?.image ? (
                                                <Image src={item.product.image} alt={item.product?.name || "Product"} width={48} height={48} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center"><Package className="w-5 h-5 text-muted-foreground" /></div>
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <p className="font-medium">{item.product?.name || t("adm_deletedProduct")}</p>
                                            <p className="text-sm text-muted-foreground">
                                                {money(Number(item.price))} x {item.quantity}
                                            </p>
                                        </div>
                                        <p className="font-medium">
                                            {money(Number(item.price) * item.quantity)}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            <div className="border-t border-border mt-4 pt-4 space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t("adm_subtotal")}</span>
                                    <span>{money(Number(order.subtotal))}</span>
                                </div>
                                {Number(order.discount) > 0 && (
                                    <div className="flex justify-between text-success">
                                        <span>{t("adm_discount")}</span>
                                        <span>-{money(Number(order.discount))}</span>
                                    </div>
                                )}
                                <div className="flex justify-between text-lg font-bold">
                                    <span>{t("adm_total")}</span>
                                    <span>{money(Number(order.total))}</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {order.notes && (
                        <Card>
                            <CardHeader>
                                <CardTitle>{t("adm_notes")}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-muted-foreground">{order.notes}</p>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("adm_customer")}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="font-medium">{order.user?.username ?? t("adm_noAccount")}</p>
                            <p className="text-sm text-muted-foreground">{order.user?.email ?? "-"}</p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>{t("adm_payment")}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm">
                                <span className="text-muted-foreground">{t("adm_method")}: </span>
                                <span className="font-medium">{order.paymentMethod || "N/A"}</span>
                            </p>
                            <p className="text-sm mt-1">
                                <span className="text-muted-foreground">{t("adm_status")}: </span>
                                <span className="font-medium">{orderStatusLabel(t, ADMIN_ORDER_STATUS_KEYS, order.status)}</span>
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>{t("adm_timeline")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{t("adm_created")}</span>
                                <span>{formatDate(order.createdAt, undefined, dateTag)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{t("adm_updated")}</span>
                                <span>{formatDate(order.updatedAt, undefined, dateTag)}</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </>
    );
}
