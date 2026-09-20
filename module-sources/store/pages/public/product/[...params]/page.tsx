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
 */
import { notFound } from "next/navigation";
import { readProduct } from "../../../../lib/read-product";
import { readBulkLadder } from "../../../../lib/read-bulk-rules";
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

    return <ProductView product={product} bulkLadder={ladder} />;
}
