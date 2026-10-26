/**
 * The parts the shop's pages are built from, drawn on the server: its
 * sections as cards or as a row of chips, and a taste of every shelf.
 *
 * Server components, because each is handed what the page already read and
 * has nothing to keep; the product cards inside them are the client ones the
 * shelf has always used.
 */
import { getTranslations } from "next-intl/server";
import { Box, Coins } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { RichContent } from "@/core/sdk/ui";
import { ProductCard } from "./ProductCard";
import type { FrontShelf, StoreCategory } from "../lib/read-store";

/** `/store`, with the section, the search and the sort in the query string. */
export function storeHref(params: { category?: string; q?: string; sort?: string }): string {
    const query = new URLSearchParams();
    if (params.category) query.set("category", params.category);
    if (params.q) query.set("q", params.q);
    if (params.sort && params.sort !== "newest") query.set("sort", params.sort);
    const qs = query.toString();
    return qs ? `/store?${qs}` : "/store";
}

/** The top-level sections as cards with their pictures, the way the front always drew them. */
export async function CategoryCards({ roots }: { roots: StoreCategory[] }) {
    const t = await getTranslations("store");
    return (
        <section>
            <h2 className="text-xl font-bold text-foreground mb-6">{t("categories")}</h2>
            {roots.length === 0 ? (
                <div className="text-center py-12 bg-card rounded-xl">
                    <p className="text-muted-foreground">{t("noCategories")}</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                    {roots.map((root) => (
                        <Link
                            key={root.id}
                            href={storeHref({ category: root.slug })}
                            className="bg-card rounded-lg border border-border overflow-hidden hover:shadow-md transition-all group text-left block"
                        >
                            <div className="aspect-card bg-muted flex items-center justify-center overflow-hidden">
                                {root.image ? (
                                    <>{/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={root.image} alt={root.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" /></>
                                ) : (
                                    <Box className="w-12 h-12 text-muted-foreground" aria-hidden="true" />
                                )}
                            </div>
                            <div className="p-4">
                                <h3 className="font-semibold text-foreground">{root.name}</h3>
                                {root.description && (
                                    <RichContent className="text-sm text-muted-foreground mt-1" markdown={root.description} />
                                )}
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </section>
    );
}

/**
 * The top-level sections as a row of links, the one open marked, led by the
 * whole shop. A section is a place with an address, so each chip is a link.
 */
export async function CategoryChips({ roots, current }: { roots: StoreCategory[]; current?: string }) {
    const t = await getTranslations("store");
    if (roots.length === 0) return null;
    const chip = "inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40";
    const open = "inline-flex items-center rounded-lg border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground";
    return (
        <nav aria-label={t("categories")} data-store-chips className="flex flex-wrap gap-2">
            <Link href="/store" aria-current={current ? undefined : "page"} className={current ? chip : open}>{t("allProducts")}</Link>
            {roots.map((root) => (
                <Link
                    key={root.id}
                    href={storeHref({ category: root.slug })}
                    aria-current={current === root.slug ? "page" : undefined}
                    className={current === root.slug ? open : chip}
                >
                    {root.name}
                </Link>
            ))}
        </nav>
    );
}

/** A section's own sections, as cards. */
export async function SubcategoryCards({ parent, sections }: { parent: StoreCategory; sections: StoreCategory["children"] }) {
    const t = await getTranslations("store");
    if (sections.length === 0) return null;
    return (
        <section>
            <h2 className="text-xl font-bold text-foreground mb-6">{parent.name} - {t("categories")}</h2>
            {/* With the column's 1.5rem gap, the 2.5rem the shelf always had below it. */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6 mb-4">
                {sections.map((child) => (
                    <Link
                        key={child.id}
                        href={storeHref({ category: child.slug })}
                        className="bg-card rounded-lg border border-border overflow-hidden hover:shadow-md transition-all group text-left block"
                    >
                        <div className="aspect-card bg-muted flex items-center justify-center overflow-hidden">
                            {child.image ? (
                                <>{/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={child.image} alt={child.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" /></>
                            ) : (
                                <Coins className="w-12 h-12 text-muted-foreground" aria-hidden="true" />
                            )}
                        </div>
                        <div className="p-4">
                            <h3 className="font-medium text-foreground">{child.name}</h3>
                        </div>
                    </Link>
                ))}
            </div>
        </section>
    );
}

/**
 * A taste of every shelf: each section's name, its first products and a
 * link to the rest of it. Laid out by its box, so a narrow cell gets fewer
 * cards to a row.
 */
export async function ShelfRows({ shelves, lowStockAt }: { shelves: FrontShelf[]; lowStockAt: number }) {
    const t = await getTranslations("store");
    if (shelves.length === 0) return null;
    return (
        <div data-store-shelves className="flex flex-col gap-10">
            {shelves.map(({ category, products, total }) => (
                <section key={category.id} data-store-shelf={category.slug}>
                    <div className="mb-4 flex items-baseline justify-between gap-4">
                        <h2 className="text-xl font-bold text-foreground">{category.name}</h2>
                        {total > products.length ? (
                            <Link href={storeHref({ category: category.slug })} className="text-sm font-medium text-primary hover:underline">
                                {t("shelfAll", { count: total })}
                            </Link>
                        ) : null}
                    </div>
                    <div className="grid grid-cols-1 gap-6 @md:grid-cols-2 @3xl:grid-cols-3">
                        {products.map((product) => (
                            <ProductCard key={product.id} product={product} lowStockAt={lowStockAt} />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
