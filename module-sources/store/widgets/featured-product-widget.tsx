"use client";

import { useState, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/core/sdk/navigation";
import { Button, useSiteCurrency, buttonClassName } from "@/core/sdk/ui";
import { Crown } from "lucide-react";

interface Product {
    id: string;
    number: number;
    name: string;
    slug: string;
    price: number;
    image: string | null;
}

export function FeaturedProductWidget() {
    const sidebarT = useTranslations('sidebar');
    const locale = useLocale();
    const { format: formatPrice } = useSiteCurrency();
    const [product, setProduct] = useState<Product | null>(null);

    useEffect(() => {
        // A reader who switched language before the answer came back is not
        // shown the product in the one they left.
        let active = true;
        fetch(`/api/v1/store/products?featured=true&limit=1&locale=${encodeURIComponent(locale)}`)
            .then((res) => res.json())
            .then((data) => {
                if (!active) return;
                const products = data.products || [];
                if (products.length > 0) setProduct(products[0]);
            })
            .catch(() => {});
        return () => { active = false; };
    }, [locale]);

    if (!product) return null;

    return (
        <div className="bg-card rounded-xl border border-border p-5">
            <h2 className="font-bold text-foreground mb-4">{sidebarT('featuredProduct')}</h2>
            <div className="text-center">
                <div className="w-20 h-20 mx-auto mb-3 bg-warning/10 rounded-lg flex items-center justify-center overflow-hidden">
                    {product.image ? (
                        <>{/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={product.image} alt={product.name} className="w-full h-full object-cover" /></>
                    ) : (
                        <Crown className="w-10 h-10 text-warning" />
                    )}
                </div>
                <h3 className="font-semibold text-foreground mb-1">{product.name}</h3>
                <p className="text-primary font-bold text-lg mb-3">{formatPrice(product.price)}</p>
                <Link href={`/store/product/${product.number}/${product.slug}`} className={buttonClassName("default", "default", "w-full bg-primary hover:bg-primary/90 text-primary-foreground")}>
                        {sidebarT('viewDetails')}
                    </Link>
            </div>
        </div>
    );
}
