"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { sharedJson } from "@/core/sdk";
import { FilterChips } from "@/core/sdk/admin";
import { BlockHeading, LoadFailed, Waiting, useBlockText, type BlockProps } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import { ProductCard, type CardProduct } from "./ProductCard";

interface Shelf {
    id: string;
    name: string;
    slug: string;
    _count?: { products: number };
}

const DEFAULT_COUNT = 4;

/**
 * Room the block holds until its products arrive: a heading over one row of
 * cards, whose picture is a ratio and whose text is a fixed number of lines.
 */
const ROOM = "min-h-[24rem]";

/**
 * `store.products`: a few products from one shelf at a time, in the store's
 * own card, with a chip for every top-level shelf that has something on it.
 * A shop that has no shelves shows its newest products and no chips.
 *
 * Both answers are the shop's public ones, which a proxy may hold, and they
 * are asked through `sharedJson` so a page that draws the shop twice asks
 * once.
 */
export function ProductsBlock({ settings }: BlockProps) {
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const text = useBlockText();
    const count = typeof settings.count === "number" ? settings.count : DEFAULT_COUNT;
    const [shelves, setShelves] = useState<Shelf[] | null>(null);
    const [chosen, setChosen] = useState<string | null>(null);
    const [products, setProducts] = useState<{ shelf: string | null; rows: CardProduct[]; lowStockAt: number } | null>(null);
    // A read that did not come back says so, rather than reading as a shop
    // with nothing in it (an-empty-screen-says-which-empty).
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let active = true;
        sharedJson<{ categories?: Shelf[] }>("/api/v1/store/categories")
            .then((d) => {
                if (!active) return;
                const stocked = (d?.categories ?? []).filter((c) => (c._count?.products ?? 0) > 0);
                setShelves(stocked);
                setChosen((was) => (was && stocked.some((c) => c.slug === was) ? was : stocked[0]?.slug ?? null));
            })
            .catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [reloadKey]);

    useEffect(() => {
        if (shelves === null) return;
        let active = true;
        const query = new URLSearchParams();
        if (chosen) query.set("category", chosen);
        query.set("limit", String(count));
        sharedJson<{ products?: CardProduct[]; lowStockAt?: number }>(`/api/v1/store/products?${query}`)
            .then((d) => { if (active) setProducts({ shelf: chosen, rows: d?.products ?? [], lowStockAt: d?.lowStockAt ?? 0 }); })
            .catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [shelves, chosen, count, reloadKey]);

    // Nothing for sale anywhere: no section, the way a widget with nothing
    // to say has always drawn nothing.
    if (shelves !== null && shelves.length === 0 && products && products.rows.length === 0) return null;

    const retry = () => {
        setFailed(false);
        setProducts(null);
        setReloadKey((k) => k + 1);
    };
    const waiting = !failed && (products === null || products.shelf !== chosen);
    const chips = shelves && shelves.length > 0 ? (
        <FilterChips
            label={t("blk_shelves")}
            chips={shelves.map((s) => ({ id: s.slug, label: s.name }))}
            active={chosen ?? ""}
            onSelect={setChosen}
        />
    ) : undefined;

    return (
        <div className={waiting || failed ? `${ROOM} flex flex-col` : undefined}>
            <BlockHeading
                kicker={text(settings.kicker) || undefined}
                title={text(settings.title) || t("title")}
                action={chips}
            />
            {failed ? (
                <LoadFailed onRetry={retry} />
            ) : waiting || !products ? (
                <Waiting label={commonT("loading")} />
            ) : (
                <>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-6">
                        {products.rows.map((product) => (
                            <ProductCard key={product.id} product={product} lowStockAt={products.lowStockAt} />
                        ))}
                    </div>
                    {settings.allLink === true ? (
                        <Link href={chosen ? `/store?category=${encodeURIComponent(chosen)}` : "/store"} className="mt-6 inline-block text-sm font-bold text-primary hover:underline">
                            {t("allProducts")} ›
                        </Link>
                    ) : null}
                </>
            )}
        </div>
    );
}
