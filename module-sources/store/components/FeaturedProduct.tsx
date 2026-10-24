"use client";

import { useTranslations } from "next-intl";
import { Box } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Badge, buttonClassName, useSiteCurrency } from "@/core/sdk/ui";
import type { ShelfProduct } from "../lib/read-store";

/**
 * The product the shop is pushing, across the front of the shop: its name,
 * its one line, what it costs and what it cost before, and the way to it.
 *
 * Laid out by its box, picture beside the words where there is room and
 * above them where there is not.
 */
export function FeaturedProduct({ product }: { product: ShelfProduct }) {
    const t = useTranslations("store");
    const { format: formatPrice } = useSiteCurrency();
    const was = product.was ?? product.comparePrice ?? null;
    const onSale = was !== null && was > product.price;
    const percent = onSale ? Math.round((1 - product.price / was) * 100) : 0;
    const href = `/store/product/${product.number}/${product.slug}`;

    return (
        <section data-featured-product className="flex flex-col-reverse gap-8 rounded-xl border border-border bg-card p-6 @3xl:flex-row @3xl:items-center @3xl:p-10">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
                <div className="flex flex-wrap gap-2">
                    <Badge tone="warning" solid>{t("featured")}</Badge>
                    {percent > 0 ? <Badge tone="danger" solid>{t("discountTag", { percent })}</Badge> : null}
                    {product.durationDays ? <Badge tone="neutral">{t("durationDays", { days: product.durationDays })}</Badge> : null}
                </div>
                <h2 data-featured-name className="text-3xl font-extrabold text-foreground">{product.name}</h2>
                {product.shortDesc ? <p className="max-w-xl text-muted-foreground">{product.shortDesc}</p> : null}
                <div className="flex flex-wrap items-baseline gap-3">
                    <span data-featured-price className="text-2xl font-bold text-foreground">{formatPrice(product.price)}</span>
                    {onSale ? <span className="text-muted-foreground line-through">{formatPrice(was)}</span> : null}
                </div>
                <div className="flex flex-wrap gap-3">
                    <Link href={href} className={buttonClassName("default", "lg")}>{t("buyNow")}</Link>
                    <Link href={href} className={buttonClassName("secondary", "lg")}>{t("viewDetails")}</Link>
                </div>
            </div>
            <div data-featured-picture className="flex aspect-card w-full max-w-md shrink-0 items-center justify-center self-center overflow-hidden rounded-lg bg-muted">
                {product.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
                ) : (
                    <Box className="h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
                )}
            </div>
        </section>
    );
}
