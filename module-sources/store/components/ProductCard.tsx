"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/core/sdk/navigation";
import { Badge, useSiteCurrency } from "@/core/sdk/ui";
import { Box } from "lucide-react";
import { AvailabilityNote, LowStockNote, type AvailabilityInfo } from "./AvailabilityNote";

/**
 * One product, on a shelf.
 *
 * There were two of these on the store page and they had drifted: one showed
 * the sale price and one did not, the badges sat between the price and the
 * link so a card with a badge pushed its own price down, and a fixed 176px
 * media box meant every image was cropped to whatever that happened to be.
 * Rows of them lined up only by accident.
 *
 * So: one card, and three decisions written down.
 *
 * The media is 2:1, which is the shape a rank banner or a crate render is
 * actually drawn in, and it is a ratio rather than a height so it holds at
 * every column count.
 *
 * The bottom row is pinned. Title and badges grow upward from a fixed floor,
 * so the prices in a row are on one line whatever the cards above them say -
 * the thing a shopper compares is the thing that lines up.
 *
 * Colour means one thing here: the price turns primary only when it is a sale
 * price. A card where every price is the accent colour is a card where the
 * accent says nothing.
 */

export interface CardProduct {
    id: string;
    number: number;
    name: string;
    slug: string;
    /** What this reader pays. The upgrade credit is already off it. */
    price: number;
    /** Taken off because a cheaper rung on this shelf is already owned. */
    upgradeCredit?: number;
    /** What it costs somebody who owns nothing on this shelf. */
    fullPrice?: number;
    comparePrice?: number | null;
    was?: number | null;
    image: string | null;
    stock?: number | null;
    isFeatured?: boolean;
    category?: { name: string; slug: string } | null;
    availability?: AvailabilityInfo;
}

interface Props {
    product: CardProduct;
    /** Below this many, the card says how few are left. Zero says nothing. */
    lowStockAt?: number;
    /** Drawn above the name when the shelf mixes categories. */
    showCategory?: boolean;
}

export function ProductCard({ product, lowStockAt = 0, showCategory = false }: Props) {
    const t = useTranslations("store");
    const { format: formatPrice } = useSiteCurrency();

    const credit = Number(product.upgradeCredit ?? 0);
    const upgrading = credit > 0;
    // The struck-through figure is the sale's, or - when this reader is
    // upgrading - what the rung costs somebody starting from nothing. Both
    // answer the same question: what am I not paying.
    const was = upgrading
        ? (product.fullPrice ?? null)
        : product.was ?? product.comparePrice ?? null;
    const onSale = was !== null && Number(was) > Number(product.price);
    // A product that cannot be bought right now is dimmed rather than
    // captioned twice: the badge says why, the image says at a glance.
    const shut = product.availability ? !product.availability.buyable : false;

    return (
        <Link
            href={`/store/product/${product.number}/${product.slug}`}
            className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40"
        >
            <div className={`relative aspect-[2/1] overflow-hidden bg-muted ${shut ? "opacity-60" : ""}`}>
                {product.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={product.image}
                        alt={product.name}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center">
                        <Box className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                    </div>
                )}
                {product.isFeatured && (
                    <Badge tone="warning" className="absolute right-2 top-2">{t("featured")}</Badge>
                )}
            </div>

            <div className="flex flex-1 flex-col gap-2 p-4">
                {showCategory && product.category && (
                    <span className="text-xs text-muted-foreground">{product.category.name}</span>
                )}

                <h3 className="line-clamp-2 font-semibold leading-snug text-foreground">
                    {product.name}
                </h3>

                {(product.availability || product.stock !== null) && (
                    <div className="flex flex-wrap gap-2 empty:hidden">
                        {product.availability && <AvailabilityNote info={product.availability} compact />}
                        <LowStockNote stock={product.stock ?? null} at={lowStockAt} />
                    </div>
                )}

                <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                        <span className={`text-lg font-bold ${onSale ? "text-primary" : "text-foreground"}`}>
                            {formatPrice(Number(product.price))}
                        </span>
                        {onSale && (
                            <span className="text-sm text-muted-foreground line-through">
                                {formatPrice(Number(was))}
                            </span>
                        )}
                        {/* Why it is cheaper for this reader. Without the line
                            the card shows a lower number than the one beside
                            it for no visible reason, which reads as a mistake
                            rather than an offer. */}
                        {upgrading && (
                            <span className="w-full text-xs font-medium text-success">
                                {t("upgradeNote", { amount: credit.toFixed(2) })}
                            </span>
                        )}
                    </div>
                    <span className="whitespace-nowrap text-sm text-muted-foreground transition-colors group-hover:text-primary">
                        {t("viewDetails")} →
                    </span>
                </div>
            </div>
        </Link>
    );
}
