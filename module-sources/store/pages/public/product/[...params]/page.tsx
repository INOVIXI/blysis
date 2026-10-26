/**
 * A product, written by the server.
 *
 * The screen below stays a client component - the cart, the quantity and the
 * gallery are its job - but it used to fetch the product on mount, so not a
 * word of a product reached the HTML the server sent. All 34 product URLs the
 * sitemap publishes were empty pages to a reader without JavaScript and to
 * anything that indexes one.
 *
 * `readProduct` holds the two rules about what a visitor may see, and the
 * endpoint calls it too: a product an operator asked to hide while it is shut
 * has to answer exactly as one that does not exist, on both.
 *
 * The page is the store's `product` page, built from the gallery, the box it
 * is bought from, its description and the others on its shelf. With no word
 * from the theme it stands as it always has, the pictures and the words beside
 * the box, and the others on the shelf and the trail the header already
 * carries are not shown.
 */
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/core/sdk/navigation";
import { ArrangedPage } from "@/core/sdk/page";
import { moduleSettings } from "@/core/sdk/server";
import { RichContent } from "@/core/sdk/ui";
import { ChevronRight } from "lucide-react";
import { readProduct } from "../../../../lib/read-product";
import { readBulkLadder } from "../../../../lib/read-bulk-rules";
import { readRelated } from "../../../../lib/read-store";
import { storeHref } from "../../../../components/StoreFront";
import { ProductCard } from "../../../../components/ProductCard";
import { ProductGallery } from "../../../../components/ProductGallery";
import { ProductView } from "../../../../components/ProductView";

interface PageProps {
    params: Promise<{ params?: string | string[]; slug?: string | string[] }>;
}

/** `/store/product/<id>/<slug>` - the id is what identifies it. */
function productIdFrom(raw: string | string[] | undefined): string {
    const segments = typeof raw === "string" ? raw.split("/") : Array.isArray(raw) ? raw : [];
    const marker = segments.indexOf("product");
    return marker >= 0 && segments[marker + 1] ? segments[marker + 1] : (segments[0] ?? "");
}

export default async function ProductPage({ params }: PageProps) {
    const resolved = await params;
    const id = productIdFrom(resolved.params ?? resolved.slug);
    if (!id) notFound();

    const read = await readProduct(id);
    if (!read) notFound();

    // The window's two dates cross the boundary as the strings the screen
    // already expected of the endpoint, so nothing below had to learn a
    // second shape.
    const product = {
        ...read,
        availability: {
            ...read.availability,
            opensAt: read.availability.opensAt?.toISOString() ?? null,
            closesAt: read.availability.closesAt?.toISOString() ?? null,
        },
    };

    // What buying several of them is worth, read here so the page the server
    // sends already says it. The till charges the rung this quotes.
    const ladder = await readBulkLadder({ id: read.id, categoryId: read.category?.id ?? null });
    const t = await getTranslations("store");

    return (
        <ArrangedPage
            page="store.product"
            frame={{ title: product.name, trail: [{ label: t("title"), href: "/store" }] }}
            // The box beside the pictures is the product's, not a sidebar's
            // widget, and follows the reader down the column it stands in.
            sidebar={false}
            blocks={{
                // The header's trail, for a theme that hides the header and
                // would otherwise leave no way back to the product's shelf.
                crumbs: () => (
                    <nav aria-label={t("title")} className="text-sm text-muted-foreground flex flex-wrap items-center gap-2">
                        <Link href="/store" className="hover:text-primary">{t("title")}</Link>
                        {product.category ? (
                            <>
                                <ChevronRight className="w-4 h-4" aria-hidden="true" />
                                <Link href={storeHref({ category: product.category.slug })} className="hover:text-primary">{product.category.name}</Link>
                            </>
                        ) : null}
                        <ChevronRight className="w-4 h-4" aria-hidden="true" />
                        <span aria-current="page" className="text-foreground">{product.name}</span>
                    </nav>
                ),
                gallery: () => <ProductGallery name={product.name} image={product.image} images={product.images} />,
                buy: ({ settings }) => <ProductView product={product} bulkLadder={ladder} title={settings.title === true} />,
                // The name is the frame's title, so the card holds the
                // description alone, and a product with none has no card.
                details: () => (product.description ? (
                    <div className="bg-card rounded-lg border border-border p-6">
                        <RichContent className="text-sm text-muted-foreground" markdown={product.description} />
                    </div>
                ) : null),
                related: async () => {
                    const [others, { lowStockAt }] = await Promise.all([
                        readRelated({ id: product.id, categorySlug: product.category?.slug ?? null }, 3),
                        moduleSettings<{ lowStockAt: number }>("store"),
                    ]);
                    if (others.length === 0) return null;
                    return (
                        <section data-product-related>
                            <h2 className="text-xl font-bold text-foreground mb-4">{t("relatedProducts")}</h2>
                            <div className="grid grid-cols-1 gap-6 @md:grid-cols-2 @3xl:grid-cols-3">
                                {others.map((other) => <ProductCard key={other.id} product={other} lowStockAt={lowStockAt} />)}
                            </div>
                        </section>
                    );
                },
            }}
        />
    );
}
