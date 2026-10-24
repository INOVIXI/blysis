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
 *
 * The two kinds of place are two of the store's pages, each built from
 * blocks a theme arranges: the front (`home`) and a shelf or a search
 * (`shelf`). The front stands as it always did, the search over the
 * sections, unless a theme asks for the featured product and a taste of
 * every shelf as well.
 */
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/core/sdk/navigation";
import { Slot } from "@/core/sdk/layout";
import { ArrangedPage } from "@/core/sdk/page";
import { moduleSettings } from "@/core/sdk/server";
import { Pagination } from "@/core/sdk/ui";
import { ChevronRight } from "lucide-react";
import { FeaturedProduct } from "../../components/FeaturedProduct";
import { ProductCard } from "../../components/ProductCard";
import { StoreSearch, StoreSort } from "../../components/StoreControls";
import { CategoryCards, CategoryChips, ShelfRows, SubcategoryCards, storeHref } from "../../components/StoreFront";
import {
    readFeatured,
    readShelves,
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

/** How many products a shelf on the front shows, as a theme may set it. */
function shelfLimit(value: unknown): number {
    const n = typeof value === "number" ? Math.round(value) : 3;
    return Math.min(8, Math.max(1, n));
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

    const roots = categories.filter((c) => c.parentId === null);

    if (!search && !chosen) {
        // Read only when a theme placed them: the front of most shops shows
        // neither, and each is a query of its own.
        return (
            <ArrangedPage
                page="store.home"
                frame={{ title: t("title") }}
                blocks={{
                    search: () => <StoreSearch initial="" />,
                    categories: ({ settings }) => (settings.style === "chips"
                        ? <CategoryChips roots={roots} />
                        : <CategoryCards roots={roots} />),
                    featured: async () => {
                        const product = await readFeatured();
                        return product ? <FeaturedProduct product={product} /> : null;
                    },
                    shelves: async ({ settings }) => {
                        const [shelves, { lowStockAt }] = await Promise.all([
                            readShelves(categories, shelfLimit(settings.limit)),
                            moduleSettings<{ lowStockAt: number }>("store"),
                        ]);
                        return <ShelfRows shelves={shelves} lowStockAt={lowStockAt} />;
                    },
                }}
            />
        );
    }

    const parent = chosen?.parentId ? categories.find((c) => c.id === chosen.parentId) : undefined;
    const subCategories = chosen?.children ?? [];

    // A section with children of its own shows those; one without shows what
    // is in it, and so does a search.
    const showsProducts = Boolean(search) || Boolean(chosen && subCategories.length === 0);
    // Only a category is a ladder. A search result mixes shelves, and there is
    // nothing to compare across two of them.
    const asTable = !search && chosen?.layout === "table";
    const shelf = showsProducts
        ? await readStoreProducts({ categorySlug: search ? undefined : chosen?.slug, search, sort, page })
        : null;

    // Named because the shelf is drawn from two places: on its own, and as
    // the fallback under a comparison nobody has written yet.
    const ProductGrid = () => (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {(shelf?.products ?? []).map((product) => (
                <ProductCard
                    key={product.id}
                    product={product}
                    lowStockAt={shelf?.lowStockAt ?? 0}
                    showCategory={Boolean(search)}
                />
            ))}
        </div>
    );

    return (
        <ArrangedPage
            page="store.shelf"
            frame={{ title: chosen?.name ?? t("title") }}
            blocks={{
                crumbs: () => (
                    <nav aria-label={t("title")} className="text-sm text-muted-foreground flex items-center gap-2">
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
                ),
                search: () => <StoreSearch initial={search ?? ""} category={chosen?.slug} />,
                categories: () => <CategoryChips roots={roots} current={(parent ?? chosen)?.slug} />,
                subcategories: () => (!search && chosen ? <SubcategoryCards parent={chosen} sections={subCategories} /> : null),
                products: () => (shelf ? (
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
                        ) : asTable ? (
                            /* A ladder rather than a grid.

                               Ranks, plans and tiers are compared, not browsed: the
                               question is what the next one up adds, and a row of
                               cards answers it by making somebody open five pages
                               and remember them. The shop owns the switch, because
                               the shelf is the shop's, and knows nothing about how
                               a comparison is drawn.

                               The grid is the fallback, so a site that has turned
                               this on and then removed whatever draws comparisons
                               gets its shelf back rather than an empty page. */
                            <Slot
                                name="store.category.shelf"
                                context={{ subjectRef: `store.category:${chosen?.id}` }}
                                fallback={<ProductGrid />}
                            />
                        ) : (
                            <ProductGrid />
                        )}
                        {shelf.pages > 1 && (
                            <Pagination className="mt-6" page={shelf.page} pages={shelf.pages} total={shelf.total} pageParam="page" />
                        )}
                    </section>
                ) : null),
            }}
        />
    );
}
