/**
 * The shop, written by the server.
 *
 * Two things were wrong with the page this replaces and they had one cause:
 * everything it showed was fetched after the page had loaded, and which
 * section a shopper had opened was client state.
 *
 * So the HTML the server sent held no link to a single product - measured, 17
 * links and every one of them the shared header and footer - and the 34
 * product URLs in the sitemap had no path into them from anywhere on the site.
 * And no section of the shop had an address: a category could not be linked
 * to, shared, or reopened, and the browser's back button walked out of the
 * shop rather than up one level.
 *
 * A section is a place now. `/store` lists the top level, `?category=` opens
 * one, `?q=` searches, `?sort=` and `?page=` do the rest. The crumb trail is
 * links rather than buttons for the same reason.
 */
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/core/sdk/navigation";
import { PageFrame } from "@/core/sdk/layout";
import { Pagination, RichContent } from "@/core/sdk/ui";
import { Box, ChevronRight, Coins } from "lucide-react";
import { ProductCard } from "../../components/ProductCard";
import { StoreSearch, StoreSort } from "../../components/StoreControls";
import {
    readStoreCategories,
    readStoreProducts,
    STORE_SORTS,
    type StoreSort as SortName,
} from "../../lib/read-store";

interface PageProps {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const one = (value: string | string[] | undefined): string | undefined => {
    const first = Array.isArray(value) ? value[0] : value;
    const trimmed = first?.trim();
    return trimmed ? trimmed : undefined;
};

/** `/store`, with the section, the search and the sort in the query string. */
function storeHref(params: { category?: string; q?: string; sort?: string }): string {
    const query = new URLSearchParams();
    if (params.category) query.set("category", params.category);
    if (params.q) query.set("q", params.q);
    if (params.sort && params.sort !== "newest") query.set("sort", params.sort);
    const qs = query.toString();
    return qs ? `/store?${qs}` : "/store";
}

export default async function StorePage({ searchParams }: PageProps) {
    const query = (await searchParams) ?? {};
    const categorySlug = one(query.category);
    const search = one(query.q);
    const requestedSort = one(query.sort) ?? "newest";
    const sort: SortName = (STORE_SORTS as string[]).includes(requestedSort)
        ? (requestedSort as SortName)
        : "newest";
    const requestedPage = Number.parseInt(one(query.page) ?? "", 10);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

    const t = await getTranslations("store");
    const categories = await readStoreCategories();

    const chosen = categorySlug ? categories.find((c) => c.slug === categorySlug) : undefined;
    // A section nobody has is a 404, not the whole shop drawn as if the
    // address had been something else.
    if (categorySlug && !chosen) notFound();

    const parent = chosen?.parentId ? categories.find((c) => c.id === chosen.parentId) : undefined;
    const roots = categories.filter((c) => c.parentId === null);
    const subCategories = chosen?.children ?? [];

    // The top level lists sections rather than products, the way it always
    // has. A section with no children of its own shows what is in it.
    const showsProducts = Boolean(search) || Boolean(chosen && subCategories.length === 0);
    const shelf = showsProducts
        ? await readStoreProducts({ categorySlug: search ? undefined : chosen?.slug, search, sort, page })
        : null;

    return (
        <PageFrame title={chosen?.name ?? t("title")}>
            {(chosen || search) && (
                <nav aria-label={t("title")} className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
                    <Link href="/store" className="hover:text-primary">{t("allProducts")}</Link>
                    {parent && (
                        <>
                            <ChevronRight className="w-4 h-4" aria-hidden="true" />
                            <Link href={storeHref({ category: parent.slug })} className="text-foreground capitalize hover:text-primary">
                                {parent.name}
                            </Link>
                        </>
                    )}
                    {chosen && (
                        <>
                            <ChevronRight className="w-4 h-4" aria-hidden="true" />
                            <span className="text-foreground capitalize">{chosen.name}</span>
                        </>
                    )}
                </nav>
            )}

            <StoreSearch initial={search ?? ""} category={chosen?.slug} />

            {!search && !chosen && (
                <section>
                    <h2 className="text-xl font-bold text-foreground mb-6">{t("title")}</h2>
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
                                    <div className="h-32 bg-muted flex items-center justify-center overflow-hidden">
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
            )}

            {!search && chosen && subCategories.length > 0 && (
                <section>
                    <h2 className="text-xl font-bold text-foreground mb-6">{chosen.name} - {t("categories")}</h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-6 mb-10">
                        {subCategories.map((child) => (
                            <Link
                                key={child.id}
                                href={storeHref({ category: child.slug })}
                                className="bg-card rounded-lg border border-border overflow-hidden hover:shadow-md transition-all group text-left block"
                            >
                                <div className="h-32 bg-muted flex items-center justify-center overflow-hidden">
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
            )}

            {shelf && (
                <section>
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold text-foreground">
                            {search ? t("searchResultsFor", { query: search, count: shelf.total }) : t("products")}
                        </h2>
                        <StoreSort value={sort} category={chosen?.slug} search={search} />
                    </div>
                    {shelf.products.length === 0 ? (
                        <div className="bg-card rounded-xl p-8 text-center border border-border">
                            <p className="text-muted-foreground">{search ? t("noProductsSearch") : t("noProducts")}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                            {shelf.products.map((product) => (
                                <ProductCard
                                    key={(product as { id: string }).id}
                                    product={product as never}
                                    lowStockAt={shelf.lowStockAt}
                                    showCategory={Boolean(search)}
                                />
                            ))}
                        </div>
                    )}
                    {shelf.pages > 1 && (
                        <Pagination className="mt-6" page={shelf.page} pages={shelf.pages} total={shelf.total} pageParam="page" />
                    )}
                </section>
            )}
        </PageFrame>
    );
}
