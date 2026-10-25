"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/core/sdk/navigation";
import { LoadFailed, useSiteCurrency, buttonClassName } from "@/core/sdk/ui";
import { ArrangedClientPage } from "@/core/sdk/layout";
import { Check, Minus, Crown, Loader2 } from "lucide-react";

interface Product {
    id: string;
    number: number;
    name: string;
    slug: string;
    price: number;
    comparePrice: number | null;
    description: string | null;
    image: string | null;
    isFeatured: boolean;
    category: { name: string } | null;
}

/**
 * The lines an operator wrote in a product's description.
 *
 * This is a guess and it is treated as one below. A description is prose: a
 * product whose description is a paragraph has one "feature", and a product
 * that simply does not mention a line another product wrote has said nothing
 * about it.
 */
function parseFeatures(product: Product): string[] {
    if (product.description) {
        // Try splitting by newlines or pipes
        const lines = product.description.split(/\n|\|/).map(s => s.trim()).filter(Boolean);
        if (lines.length > 1) return lines;
    }
    return [];
}

export default function VipTablePage() {
    const t = useTranslations("store");
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const { format: formatPrice } = useSiteCurrency();

    useEffect(() => {
        let cancelled = false;
        // Fetch featured products to use as VIP ranks
        fetch("/api/v1/store/products?featured=true&limit=10")
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((data) => { if (cancelled) return;
                setProducts(data.products || []);
                setFailed(false);
                setLoading(false);
            })
            .catch(() => { if (cancelled) return; setFailed(true); setLoading(false); });
        return () => { cancelled = true; };
    }, [reloadKey]);

    const frame = { title: t("vip_title"), description: t("vip_subtitle"), trail: [{ label: t('title'), href: '/store' }] };

    if (loading) {
        return (
            <ArrangedClientPage page="store.vip" frame={frame} blocks={{}}>
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            </ArrangedClientPage>
        );
    }

    // Collect all unique features across products
    const allFeatures: string[] = [];
    const productFeatures = products.map((p) => {
        const features = parseFeatures(p);
        features.forEach((f) => {
            if (!allFeatures.includes(f)) allFeatures.push(f);
        });
        return { product: p, features };
    });

    return (
        <ArrangedClientPage
            page="store.vip"
            frame={frame}
            blocks={{
                ranks: () => (
                    failed ? (
                        <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
                    ) : products.length === 0 ? (
                        <div className="text-center py-12 bg-card rounded-xl border border-border">
                            <Crown className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                            <p className="text-muted-foreground">{t("vip_empty")}</p>
                        </div>
                    ) : allFeatures.length > 0 ? (
                        /* Full comparison table when features are available */
                        <div className="bg-card rounded-xl border border-border overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left py-4 px-6 font-medium text-muted-foreground min-w-[200px]">{t("vip_feature")}</th>
                                        {productFeatures.map(({ product }) => (
                                            <th key={product.id} className="text-center py-4 px-4 min-w-[150px]">
                                                <div className="flex flex-col items-center gap-1">
                                                    {product.image ? (
                                                        <>{/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img src={product.image} alt="" className="w-10 h-10 rounded-lg object-cover" /></>
                                                    ) : (
                                                        <Crown className="w-8 h-8 text-warning" />
                                                    )}
                                                    <span className="font-bold text-foreground">{product.name}</span>
                                                    <div>
                                                        {product.comparePrice && (
                                                            <span className="text-xs text-muted-foreground line-through mr-1">{formatPrice(product.comparePrice)}</span>
                                                        )}
                                                        <span className="text-primary font-bold">{formatPrice(product.price)}</span>
                                                    </div>
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {allFeatures.map((feature, i) => (
                                        <tr key={i} className={i % 2 === 0 ? "bg-muted" : ""}>
                                            <td className="py-3 px-6 text-sm text-foreground">{feature}</td>
                                            {productFeatures.map(({ product, features }) => (
                                                <td key={product.id} className="text-center py-3 px-4">
                                                    {features.includes(feature) ? (
                                                        <Check className="w-5 h-5 text-success mx-auto" />
                                                    ) : (
                                                        /*
                                                         * A dash, not a cross. This table is
                                                         * built by splitting descriptions on
                                                         * newlines, so a product that does not
                                                         * repeat another product's line has
                                                         * said nothing about it - and a cross
                                                         * told a buyer, in red, that it lacked
                                                         * something nobody ever claimed. Where
                                                         * an operator wants to state a no, the
                                                         * comparison-table module is where they
                                                         * can.
                                                         */
                                                        <Minus className="w-5 h-5 text-muted-foreground/60 mx-auto" aria-label={t("vip_notStated")} />
                                                    )}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t">
                                        <td className="py-4 px-6"></td>
                                        {productFeatures.map(({ product }) => (
                                            <td key={product.id} className="text-center py-4 px-4">
                                                <Link href={`/store/product/${product.number}/${product.slug}`} className={buttonClassName("default", "sm", "bg-primary hover:bg-primary/90 text-primary-foreground")}>
                                                        {t("vip_buy")}
                                                    </Link>
                                            </td>
                                        ))}
                                    </tr>
                                </tfoot>
                            </table>
                            <p className="px-6 py-3 text-xs text-muted-foreground">{t("vip_notStatedNote")}</p>
                    
                        </div>
                    ) : (
                        /* Card layout when no feature comparison */
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {products.map((product, i) => (
                                <div
                                    key={product.id}
                                    className={`bg-card rounded-xl border p-6 text-center relative ${i === Math.floor(products.length / 2) ? "ring-2 ring-primary scale-105" : ""}`}
                                >
                                    {i === Math.floor(products.length / 2) && (
                                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs px-3 py-1 rounded-full font-bold">
                                            {t("vip_popular")}
                                        </div>
                                    )}
                                    {product.image ? (
                                        <>{/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={product.image} alt="" className="w-16 h-16 rounded-lg object-cover mx-auto mb-3" /></>
                                    ) : (
                                        <Crown className="w-12 h-12 text-warning mx-auto mb-3" />
                                    )}
                                    <h2 className="text-xl font-bold text-foreground mb-1">{product.name}</h2>
                                    <div className="mb-4">
                                        {product.comparePrice && (
                                            <span className="text-muted-foreground line-through text-sm mr-2">{formatPrice(product.comparePrice)}</span>
                                        )}
                                        <span className="text-2xl font-bold text-primary">{formatPrice(product.price)}</span>
                                    </div>
                                    {product.description && (
                                        <p className="text-sm text-muted-foreground mb-4">{product.description}</p>
                                    )}
                                    <Link href={`/store/product/${product.number}/${product.slug}`} className={buttonClassName("default", "default", "w-full bg-primary hover:bg-primary/90 text-primary-foreground")}>
                                            {t("vip_buy")}
                                        </Link>
                                </div>
                            ))}
                        </div>
                    )
                ),
            }}
        />
    );
}
