"use client";

import { useState, useEffect } from "react";
import { useRouter } from "@/core/sdk/navigation";
import { Badge, Button, NativeSelect, useSiteCurrency } from "@/core/sdk/ui";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Minus, Plus, Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { errorMessage } from "@/core/sdk";
import { AvailabilityNote, LowStockNote, type AvailabilityInfo } from "./AvailabilityNote";
import { type BulkRung } from "../lib/pricing";

interface Product {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    /** The one line about it the operator wrote for a card. */
    shortDesc?: string | null;
    /** How long a purchase lasts, in days; null is owned outright. */
    durationDays?: number | null;
    /** What this reader pays. The upgrade credit is already off it. */
    price: number;
    comparePrice: number | null;
    /** Taken off because a cheaper rung on this shelf is already owned. */
    upgradeCredit?: number;
    /** What it costs somebody who owns nothing on this shelf. */
    fullPrice?: number;
    image: string | null;
    images?: string[];
    stock: number | null;
    isActive: boolean;
    /**
     * Nullable, because `Product.categoryId` is. A shop that does not sort
     * its products into categories is a shop the platform supports, and a
     * type that says otherwise is how an uncategorised product took its own
     * page down.
     */
    category: {
        id: string;
        name: string;
        slug: string;
    } | null;
    availability?: AvailabilityInfo;
    was?: number | null;
    onSale?: boolean;
    lowStockAt?: number;
}

/**
 * The box a product is bought from, drawn from what the server already read:
 * the price, whether it can be had, how many, what the operator asks the
 * buyer to fill in, and the buttons. The product page's `buy` block.
 *
 * It used to fetch the product on mount, so not a word of a product reached
 * the HTML the server sent - for all 34 product URLs in the sitemap. The server
 * renders it now; the cart and the quantity are still this component's job.
 *
 * `title` is the block's setting of that name: the box then opens with the
 * product's section, any discount, its name and its one line, for a theme
 * that hides the page's header and lets the box name the product.
 */
export function ProductView({
    product: initialProduct,
    bulkLadder = [],
    title = false,
}: {
    product: Product;
    /**
     * What buying several is worth, worked out on the server from the rules
     * that cover this product. Empty where none do.
     */
    bulkLadder?: BulkRung[];
    title?: boolean;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const { status: authStatus } = useSession();
    const { format: formatPrice } = useSiteCurrency();
    const t = useTranslations('store');
    const commonT = useTranslations('common');

    const requireLogin = () => {
        toast.error(t("loginRequired"), {
            action: {
                label: t("login"),
                onClick: () => router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname || "/")}`),
            },
        });
    };

    const product = initialProduct;
    const [quantity, setQuantity] = useState(1);
    const [addingToCart, setAddingToCart] = useState(false);
    const [addedToCart, setAddedToCart] = useState(false);
    const [variables, setVariables] = useState<{ name: string; label: string; type: string; required: boolean; placeholder?: string; options?: string }[]>([]);
    const [variableValues, setVariableValues] = useState<Record<string, string>>({});


    // Fetch product variables
    useEffect(() => {
        let cancelled = false;
        if (!product) return;
        fetch(`/api/v1/product-variables?productId=${product.id}`)
            .then((r) => r.json())
            .then((d) => {
                if (cancelled) return;
                setVariables(d.variables || []);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [product?.id]);

    const addToCart = async () => {
        if (!product) return;
        if (authStatus !== "authenticated") { requireLogin(); return; }
        setAddingToCart(true);
        try {
            const res = await fetch("/api/v1/store/cart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productId: product.id, quantity }),
            });
            if (res.ok) {
                setAddedToCart(true);
                toast.success(t("addedToCartToast", { name: product.name }));
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("cart:updated"));
                }
                setTimeout(() => setAddedToCart(false), 2000);
            } else if (res.status === 401) {
                requireLogin();
            } else {
                const body = await res.json().catch(() => ({}));
                toast.error(errorMessage(body, t("addToCartError"), t));
            }
        } catch (err) {
            console.error("Failed to add to cart:", err);
            toast.error(t("addToCartError"));
        } finally {
            setAddingToCart(false);
        }
    };

    const buyNow = async () => {
        if (!product) return;
        if (authStatus !== "authenticated") { requireLogin(); return; }
        setAddingToCart(true);
        try {
            const res = await fetch("/api/v1/store/cart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productId: product.id, quantity }),
            });
            if (res.ok) {
                router.push("/store/cart");
            } else if (res.status === 401) {
                requireLogin();
            } else {
                toast.error(t('cartAddFailed'));
            }
        } catch (err) {
            console.error("Failed to add to cart:", err);
            toast.error(t("cartAddFailed"));
        } finally {
            setAddingToCart(false);
        }
    };

    // Neither branch that used to stand here can happen now: the server read
    // the product before this rendered, and a product it could not read is a
    // 404 rather than a page saying so.

    const maxStock = product.stock ?? 99;
    /*
     * The rung this quantity has reached, and what the line costs with it.
     *
     * The till has always taken this off and nothing on the way to it said
     * so, so the number under the quantity control was one a shopper was
     * never charged. Both come from `pricing.ts`, which is what the checkout
     * charges by, so the two cannot disagree.
     */
    const bulkPercent = bulkLadder
        .filter((rung) => rung.minQuantity <= quantity)
        .reduce((best, rung) => Math.max(best, rung.discountPercent), 0);
    const totalPrice = Math.round(product.price * quantity * (1 - bulkPercent / 100) * 100) / 100;
    const upgradeCredit = Number(product.upgradeCredit ?? 0);
    const inStock = product.stock === null || product.stock > 0;
    // The window, the per-person limit and today's allowance, answered by the
    // endpoint for this person. The button follows it rather than guessing.
    const availability = product.availability;
    const lowStockAt = Number(product.lowStockAt ?? 0);
    const forSale = inStock && (availability?.buyable ?? true);
    const percentOff = upgradeCredit === 0 && product.comparePrice && product.comparePrice > product.price
        ? Math.round((1 - product.price / product.comparePrice) * 100)
        : 0;

    return (
        <div className="bg-card rounded-lg border border-border p-6 sticky top-24" data-product-box>
            {title && (
                <div data-product-title className="mb-4 space-y-3">
                    {(product.category || percentOff > 0 || product.durationDays) && (
                        <div className="flex flex-wrap gap-2">
                            {product.category && <Badge tone="neutral">{product.category.name}</Badge>}
                            {percentOff > 0 && <Badge tone="danger" solid>{t("discountTag", { percent: percentOff })}</Badge>}
                            {product.durationDays ? <Badge tone="neutral">{t("durationDays", { days: product.durationDays })}</Badge> : null}
                        </div>
                    )}
                    {/* Not a heading: the page's h1 is the name,
                        read but not seen when this is drawn. */}
                    <p aria-hidden="true" className="text-3xl font-extrabold text-foreground">{product.name}</p>
                    {product.shortDesc && <p className="text-sm text-muted-foreground">{product.shortDesc}</p>}
                </div>
            )}

            {/* Price.

                Two different reasons to show a struck-through
                figure, and they must not both fire: a sale is what
                everybody saves, an upgrade is what this reader
                saves. Showing the sale's line under an upgraded
                price would be subtracting the same thing twice on
                screen. */}
            <div className="mb-4">
                <div className="flex items-baseline gap-2">
                    {upgradeCredit > 0 ? (
                        product.fullPrice !== undefined && (
                            <span className="text-lg text-muted-foreground line-through">{formatPrice(product.fullPrice)}</span>
                        )
                    ) : product.comparePrice ? (
                        <span className="text-lg text-muted-foreground line-through">{formatPrice(product.comparePrice)}</span>
                    ) : null}
                    <span className="text-3xl font-bold text-foreground">{formatPrice(product.price)}</span>
                </div>
                {upgradeCredit > 0 ? (
                    <div className="mt-2 inline-block rounded bg-success/10 px-2 py-1 text-xs font-medium text-success">
                        {t("upgradeNote", { amount: upgradeCredit.toFixed(2) })}
                    </div>
                ) : product.comparePrice ? (
                    <div className="inline-block bg-success/10 text-success text-xs font-medium px-2 py-1 rounded mt-2">
                        {t('save', { amount: formatPrice(product.comparePrice - product.price) })}
                    </div>
                ) : null}
            </div>

            {availability && (
                <div className="mb-4">
                    <AvailabilityNote info={availability} />
                    {availability.remainingForPerson !== null && availability.remainingForPerson !== undefined && (
                        <p className="mt-1 text-sm text-muted-foreground">
                            {t("perPersonLeft", { count: availability.remainingForPerson })}
                        </p>
                    )}
                </div>
            )}

            {/* Stock */}
            <div className="flex items-center gap-2 text-sm mb-4">
                <div className={`w-2 h-2 rounded-full ${inStock ? 'bg-success' : 'bg-destructive'}`}></div>
                <span className="text-muted-foreground">{inStock ? t('inStock') : t('outOfStock')}</span>
                {product.stock !== null && inStock && (
                    <span className="text-muted-foreground">({t('available', { count: product.stock })})</span>
                )}
                <LowStockNote stock={product.stock} at={lowStockAt} />
            </div>

            {/* Quantity */}
            {forSale && (
                <div className="mb-4">
                    <label className="text-sm font-medium text-foreground mb-2 block">{t('quantity')}</label>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setQuantity(Math.max(1, quantity - 1))}
                            aria-label={commonT('decreaseQuantity')}
                            className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-muted"
                        >
                            <Minus className="w-4 h-4" aria-hidden="true" />
                        </button>
                        <span className="text-lg font-medium text-foreground w-12 text-center">{quantity}</span>
                        <button
                            onClick={() => setQuantity(Math.min(maxStock, quantity + 1))}
                            aria-label={commonT('increaseQuantity')}
                            className="w-10 h-10 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-muted"
                        >
                            <Plus className="w-4 h-4" aria-hidden="true" />
                        </button>
                    </div>
                    {bulkPercent > 0 && (
                        <p className="mt-2 inline-block rounded bg-success/10 px-2 py-1 text-xs font-medium text-success">
                            {t("bulkApplied", { percent: bulkPercent, quantity })}
                        </p>
                    )}
                </div>
            )}

            {/* What taking more is worth. An offer a shopper is
                not told about cannot bring them a second one. */}
            {forSale && bulkLadder.length > 0 && (
                <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3">
                    <p className="text-sm font-medium text-foreground">{t("bulkLadderTitle")}</p>
                    <ul className="mt-1 space-y-0.5">
                        {bulkLadder.map((rung) => (
                            <li key={rung.minQuantity} className="text-xs text-muted-foreground">
                                {t("bulkLadderRung", { quantity: rung.minQuantity, percent: rung.discountPercent })}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Product Variables */}
            {variables.length > 0 && (
                <div className="mb-4 space-y-3">
                    {variables.map((v) => (
                        <div key={v.name}>
                            <label className="text-sm font-medium text-foreground mb-1 block">
                                {v.label} {v.required && <span className="text-destructive">*</span>}
                            </label>
                            {v.type === "select" && v.options ? (
                                <NativeSelect
                                    aria-label={v.label}
                                    value={variableValues[v.name] || ""}
                                    onChange={(e) => setVariableValues({ ...variableValues, [v.name]: e.target.value })} className="w-full"
                                    required={v.required}
                                >
                                    <option value="">{t("product_selectOption")}</option>
                                    {v.options.split(",").map((opt) => (
                                        <option key={opt.trim()} value={opt.trim()}>{opt.trim()}</option>
                                    ))}
                                </NativeSelect>
                            ) : (
                                <input
                                    aria-label={v.label}
                                    type={v.type || "text"}
                                    value={variableValues[v.name] || ""}
                                    onChange={(e) => setVariableValues({ ...variableValues, [v.name]: e.target.value })}
                                    placeholder={v.placeholder || v.label}
                                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                                    required={v.required}
                                />
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Total */}
            <div className="border-t border-border pt-4 mb-4">
                <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">{t('total')}</span>
                    <span className="text-xl font-bold text-foreground">{formatPrice(totalPrice)}</span>
                </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
                <Button
                    className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-sm"
                    onClick={buyNow}
                    disabled={!forSale || addingToCart}
                >
                    {addingToCart ? <Loader2 className="w-4 h-4 animate-spin" /> : t('buyNow')}
                </Button>
                <Button
                    variant="outline"
                    className="flex-1 border-border text-foreground hover:bg-muted rounded-sm"
                    onClick={addToCart}
                    disabled={!forSale || addingToCart}
                >
                    {addedToCart ? (
                        <><Check className="w-4 h-4" /> {t('addedToCart')}</>
                    ) : (
                        t('addToCart')
                    )}
                </Button>
            </div>

            {product.category && (
                <div className="mt-4 pt-4 border-t border-border">
                    <div className="text-xs text-muted-foreground">
                        {t('category')}: <span className="text-foreground">{product.category.name}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
