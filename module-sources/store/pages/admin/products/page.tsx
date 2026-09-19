"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import Image from "next/image";
import { Link } from "@/core/sdk/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, ListControls, Pagination, buttonClassName, useSiteCurrency } from "@/core/sdk/ui";
import { Loader2, Copy, Package, Plus } from "lucide-react";
import { AdminPageHeader } from "@/core/sdk/admin";
import { errorMessage } from "@/core/sdk";
import { toast } from "sonner";

interface Product {
    id: string;
    name: string;
    slug: string;
    price: number;
    stock: number | null;
    image: string | null;
    isActive: boolean;
    isFeatured: boolean;
    category: { name: string } | null;
    /**
     * What the shop has sold, not how many order lines mention it.
     *
     * This column used to print `_count.orderItems`, which the endpoint
     * behind it has never sent, so it drew a zero for every product in every
     * install. `unitsSold` is incremented where a claim is paid for and
     * decremented on a refund, and it is the same column the public "most
     * popular" ordering reads.
     */
    unitsSold: number;
}

export default function AdminProductsPage() {
    const { format: money } = useSiteCurrency();
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    // The endpoint has taken a `search` since it was written; the screen
    // never sent one, so the only way to a product was to page to it.
    const [search, setSearch] = useState("");
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [copying, setCopying] = useState<string | null>(null);

    const fetchProducts = async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams({ page: String(page), limit: "20" });
            if (search.trim()) query.set("search", search.trim());
            const res = await fetch(`/api/v1/store/admin/products?${query}`);
            if (res.ok) {
                const data = await res.json();
                setProducts(data.products || []);
                setTotal(data.pagination?.total || data.total || 0);
                setTotalPages(data.pagination?.pages || data.pages || 1);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    /* eslint-disable react-hooks/exhaustive-deps */
    useEffect(() => {
        fetchProducts();
    }, [page, search]);
    /* eslint-enable react-hooks/exhaustive-deps */

    // The copy's name is sent from here rather than made by the endpoint: it
    // is a row a visitor reads, and this is the only place that knows which
    // language the operator is working in.
    const copyProduct = async (product: Product) => {
        setCopying(product.id);
        try {
            const res = await fetch(`/api/v1/store/admin/products/${product.id}/copy`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: t("adm_productCopySuffix", { name: product.name }) }),
            });
            if (!res.ok) {
                toast.error(errorMessage(await res.json().catch(() => null), t("adm_productCopyFailed"), t));
                return;
            }
            toast.success(t("adm_productCopied"));
            setPage(1);
            await fetchProducts();
        } catch {
            toast.error(commonT("somethingWentWrong"));
        } finally {
            setCopying(null);
        }
    };

    return (
        <>
            <AdminPageHeader
                title={t("adm_products")}
                description={t("adm_productsTotal", { count: total })}
                actions={<>
                    <Link href="/admin/store/products/new" className={buttonClassName("default", "default")}><Plus className="w-4 h-4" /> {t("adm_addProduct")}</Link>
                </>}
            />

            <ListControls
                className="mb-4"
                search={{
                    value: search,
                    onChange: (term) => { setSearch(term); setPage(1); },
                }}
            />

            <Card>
                <CardHeader>
                    <CardTitle>{t("adm_allProducts")}</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : products.length === 0 && search.trim() !== "" ? (
                        // Not "no products yet" with a shelf full of them: that
                        // sentence tells an operator their catalogue has gone.
                        <p className="text-muted-foreground text-center py-12">{commonT("noResults")}</p>
                    ) : products.length === 0 ? (
                        <div className="text-center py-12">
                            <Package className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
                            <p className="text-muted-foreground">{t("adm_noProductsYet")}</p>
                            <Link href="/admin/store/products/new" className={buttonClassName("default", "default", "mt-4")}><Plus className="w-4 h-4" /> {t("adm_createFirstProduct")}</Link>
                        </div>
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr>
                                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_product")}</th>
                                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_category")}</th>
                                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_price")}</th>
                                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_stock")}</th>
                                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_sales")}</th>
                                            <th className="text-left py-3 px-4 font-medium text-muted-foreground">{t("adm_status")}</th>
                                            <th className="text-right py-3 px-4 font-medium text-muted-foreground">{t("adm_actions")}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {products.map((product) => (
                                            <tr key={product.id} className="hover:bg-muted/50">
                                                <td className="py-3 px-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 bg-muted rounded-lg overflow-hidden flex-shrink-0">
                                                            {product.image ? (
                                                                <Image src={product.image} alt={product.name} width={40} height={40} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center"><Package className="w-4 h-4 text-muted-foreground" /></div>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <p className="font-medium">{product.name}</p>
                                                            <p className="text-xs text-muted-foreground">{product.slug}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4 text-muted-foreground">
                                                    {product.category?.name || "-"}
                                                </td>
                                                <td className="py-3 px-4 font-medium">
                                                    {money(Number(product.price))}
                                                </td>
                                                <td className="py-3 px-4">
                                                    {product.stock === null ? "∞" : product.stock}
                                                </td>
                                                <td className="py-3 px-4 text-muted-foreground">
                                                    {product.unitsSold}
                                                </td>
                                                <td className="py-3 px-4">
                                                    <span className={`text-xs px-2 py-1 rounded ${product.isActive
                                                        ? "bg-success/10 text-success"
                                                        : "bg-muted text-muted-foreground"
                                                        }`}>
                                                        {product.isActive ? t("adm_active") : t("adm_inactive")}
                                                    </span>
                                                    {product.isFeatured && (
                                                        <span className="text-xs px-2 py-1 rounded bg-warning/10 text-warning ml-1">
                                                            {t("adm_featured")}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="py-3 px-4 text-right">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        aria-label={`${t("adm_productCopy")}: ${product.name}`}
                                                        disabled={copying !== null}
                                                        onClick={() => copyProduct(product)}
                                                    >
                                                        {copying === product.id
                                                            ? <Loader2 className="w-4 h-4 animate-spin" />
                                                            : <Copy className="w-4 h-4" aria-hidden="true" />}
                                                    </Button>
                                                    <Link href={`/admin/store/products/${product.id}/edit`} className={buttonClassName("ghost", "sm")}>{t("adm_edit")}</Link>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <Pagination page={page} pages={totalPages} onPageChange={setPage} />
                        </>
                    )}
                </CardContent>
            </Card>
        </>
    );
}
