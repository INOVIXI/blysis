"use client";

import { useEffect, useState } from "react";
import { BillingFields, EMPTY_BILLING } from "./BillingFields";
import type { BillingDetails } from "../../../lib/billing";
import Image from "next/image";
import { Link, useRouter } from "@/core/sdk/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, useConfirm, useSiteCurrency, buttonClassName, Waiting } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { Loader2, Check, X, CreditCard, Coins, ShoppingCart } from "lucide-react";
import { NavIcon } from "@/core/sdk/ui";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { writeError, errorMessage } from "@/core/sdk";

interface CartItem {
    id: string;
    quantity: number;
    /** What this buyer pays for one of them, credit already off. */
    payPrice?: number;
    /** Taken off because a cheaper rung on the same shelf is already owned. */
    upgradeCredit?: number;
    product: {
        id: string;
        name: string;
        slug: string;
        price: number;
        image: string | null;
        stock: number | null;
    };
}

/** One installed gateway, as `/store/payment-providers` describes it. */
interface PaymentProvider {
    id: string;
    label: string;
    description?: string;
    icon?: string;
}

interface CartData {
    items: CartItem[];
    itemCount: number;
    total: number;
}

/**
 * Draws the Lucide icon a gateway named in its `payment.providers` answer.
 *
 * The name comes from an installed module, so it is trusted but not
 * guaranteed to exist: a typo falls back to a card rather than crashing the
 * checkout page.
 */
function ProviderIcon({ name }: { name?: string }) {
    // The gateway names its icon in its manifest, so this is data. Answering
    // it with `import * as LucideIcons` pulled all 1,723 icon modules into the
    // chunk group every module page shares - 189 KB gzipped on each of them,
    // measured on a production build.
    return <NavIcon name={name} className="w-5 h-5 text-muted-foreground flex-shrink-0" fallback={CreditCard} />;
}

export default function CartPage() {
    const router = useRouter();
    const { format: formatPrice } = useSiteCurrency();
    const t = useTranslations('store');
    const { confirm } = useConfirm();
    const commonT = useTranslations('common');
    const [cart, setCart] = useState<CartData | null>(null);
    const [loading, setLoading] = useState(true);
    const [couponCode, setCouponCode] = useState("");
    const [couponApplied, setCouponApplied] = useState<string | null>(null);
    const [couponDiscount, setCouponDiscount] = useState(0);
    const [couponError, setCouponError] = useState<string | null>(null);
    const [checkingOut, setCheckingOut] = useState(false);
    const [checkoutError, setCheckoutError] = useState<string | null>(null);
    const [playerName, setPlayerName] = useState("");
    const [creatorCodeInput, setCreatorCodeInput] = useState("");
    const [creatorApplied, setCreatorApplied] = useState<{ code: string; discountPercent: number; creator: string; discount: number } | null>(null);
    const [creatorError, setCreatorError] = useState<string | null>(null);
    // The gateway ids come from whichever gateway modules are installed, so
    // this is a plain string rather than a union the store would have to know.
    const [paymentMethod, setPaymentMethod] = useState<string>("");
    const [providers, setProviders] = useState<PaymentProvider[]>([]);
    const [creditsAvailable, setCreditsAvailable] = useState(false);
    const [creditBalance, setCreditBalance] = useState<number>(0);
    const [billingRequired, setBillingRequired] = useState(false);
    const [billing, setBilling] = useState<BillingDetails>(EMPTY_BILLING);
    // Which boxes the endpoint named, so the form marks them rather than
    // saying "something is missing" over a page of fields.
    const [billingMissing, setBillingMissing] = useState<string[]>([]);

    useEffect(() => {
        fetchCart();
        // Which gateways are installed and configured is a question only the
        // server can answer - it is the sum of the payment.providers filter.
        fetch("/api/v1/store/payment-providers")
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                setBillingRequired(data?.billingRequired === true);
                const list: PaymentProvider[] = Array.isArray(data?.providers) ? data.providers : [];
                setProviders(list);
                setPaymentMethod(prev => prev || list[0]?.id || "");
            })
            .catch(() => {});
        // The wallet is a module too: no credits endpoint, no credits button.
        fetch("/api/v1/credits")
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data?.balance === undefined) return;
                setCreditsAvailable(true);
                setCreditBalance(Number(data.balance));
                setPaymentMethod(prev => prev || "credits");
            })
            .catch(() => {});
    }, []);

    const fetchCart = async () => {
        try {
            const res = await fetch("/api/v1/store/cart");
            if (res.ok) {
                const data = await res.json();
                setCart(data);
            }
        } catch (error) {
            console.error("Failed to fetch cart:", error);
        } finally {
            setLoading(false);
        }
    };

    const updateQuantity = async (productId: string, quantity: number) => {
        try {
            const res = await fetch("/api/v1/store/cart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productId, quantity }),
            });
            const failed = await writeError(res, t("cartUpdateFailed"), t);
            if (failed) { toast.error(failed); return; }
            fetchCart();
        } catch (error) {
            console.error("Failed to update cart:", error);
        }
    };

    const removeItem = async (productId: string) => {
        updateQuantity(productId, 0);
    };

    const clearCart = async () => {
        // One click emptied it, with nothing between the pointer and an hour
        // of picking things out.
        const ok = await confirm({
            title: t("clearCart"),
            message: t("clearCartConfirm"),
            confirmText: t("clear"),
            variant: "danger",
        });
        if (!ok) return;
        try {
            const res = await fetch("/api/v1/store/cart", { method: "DELETE" });
            const failed = await writeError(res, t("cartUpdateFailed"), t);
            if (failed) { toast.error(failed); return; }
            fetchCart();
        } catch (error) {
            console.error("Failed to clear cart:", error);
        }
    };

    const applyCoupon = async () => {
        if (!couponCode.trim()) return;
        setCouponError(null);
        setCouponApplied(null);
        setCouponDiscount(0);

        try {
            const res = await fetch("/api/v1/store/coupons/validate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: couponCode.trim() }),
            });
            const data = await res.json();
            if (data.valid) {
                setCouponApplied(data.coupon.code);
                setCouponDiscount(data.coupon.discount);
            } else if (data.code === "coupon_min_purchase" && typeof data.minPurchase === "number") {
                // The one refusal carrying a number, so it is said here rather
                // than looked up: the endpoint knows the amount and this page
                // knows which currency the shop is in. It used to arrive as
                // "Minimum purchase: $50.00" whatever the shop charged in,
                // and the page threw it away unread.
                setCouponError(t("err_couponMinPurchase", { amount: formatPrice(data.minPurchase) }));
            } else {
                setCouponError(errorMessage(data, t("err_invalidCoupon"), t));
            }
        } catch {
            setCouponError(t("err_validateCoupon"));
        }
    };

    const removeCoupon = () => {
        setCouponApplied(null);
        setCouponDiscount(0);
        setCouponCode("");
        setCouponError(null);
    };

    const applyCreatorCode = async () => {
        if (!creatorCodeInput.trim()) return;
        setCreatorError(null);
        setCreatorApplied(null);
        try {
            const res = await fetch(`/api/v1/store/creator-codes/validate?code=${encodeURIComponent(creatorCodeInput.trim())}`);
            const data = await res.json();
            if (data.valid) {
                setCreatorApplied({ code: data.code, discountPercent: data.discountPercent, creator: data.creator, discount: Number(data.discount ?? 0) });
            } else {
                setCreatorError(t("err_invalidCreatorCode"));
            }
        } catch {
            setCreatorError(t("err_validateCreatorCode"));
        }
    };

    const removeCreatorCode = () => {
        setCreatorApplied(null);
        setCreatorCodeInput("");
        setCreatorError(null);
    };

    const handleCheckout = async () => {
        if (!cart || cart.items.length === 0) return;
        if (!playerName.trim()) { setCheckoutError(t('playerNameRequired')); return; }

        setCheckingOut(true);
        setCheckoutError(null);

        try {
            // Step 1: Create the order via the standard checkout endpoint
            const res = await fetch("/api/v1/store/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items: cart.items.map((item) => ({
                        productId: item.product.id,
                        quantity: item.quantity,
                    })),
                    playerName: playerName.trim(),
                    ...(billingRequired ? { billingDetails: billing } : {}),
                    couponCode: couponApplied || undefined,
                    creatorCode: creatorApplied?.code || undefined,
                    paymentMethod,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                setBillingMissing(Array.isArray(data?.missing) ? data.missing : []);
                setCheckoutError(errorMessage(data, t("err_checkoutFailed"), t));
                return;
            }

            // Step 2: follow the gateway. Which one it was is not this page's
            // business - the checkout route answers with a URL or with nothing.
            if (data.redirect) {
                window.location.href = data.redirect;
                return;
            }

            // Free order or dev mode: redirect to success page
            router.push("/store/order-success");
        } catch {
            setCheckoutError(t("err_generic"));
        } finally {
            setCheckingOut(false);
        }
    };

    const finalTotal = cart ? cart.total - couponDiscount : 0;

    return (
        <PageFrame
            title={t('shoppingCart')}
            trail={[{ label: t('title'), href: '/store' }]}
        >
            {loading ? (
                // The minimum height is the card below it, which is what a
                // visitor with nothing in their cart gets: a mark, a heading,
                // a line of explanation and a button. Left to itself the
                // waiting box stood 128px tall against that card's 300px, so
                // the answer arriving pushed the footer down by 174px. The
                // number is measured rather than reasoned: `a-waiting-page-is
                // -the-size-of-its-answer` reads the page length either side
                // of the answer and wants the difference to be zero.
                <Card>
                    <CardContent className="py-12 text-center">
                        <Waiting label={commonT("loading")} className="min-h-[204px]" />
                    </CardContent>
                </Card>
            ) : !cart || cart.items.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <ShoppingCart className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                        <h2 className="text-xl font-semibold mb-2">{t('cartEmpty')}</h2>
                        <p className="text-muted-foreground mb-6">
                            {t('cartEmptyDesc')}
                        </p>
                        <Link href="/store" className={buttonClassName("default", "default")}>{t('browseStore')}</Link>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid lg:grid-cols-3 gap-8">
                    {/* Cart Items */}
                    <div className="lg:col-span-2 space-y-4">
                        {cart.items.map((item) => (
                            <Card key={item.id}>
                                <CardContent className="p-4">
                                    <div className="flex gap-4">
                                        <div className="w-20 h-20 bg-muted rounded-lg overflow-hidden flex-shrink-0">
                                            {item.product.image ? (
                                                <Image
                                                    src={item.product.image}
                                                    alt={item.product.name}
                                                    width={80}
                                                    height={80}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-muted">
                                                    <ShoppingCart className="w-6 h-6 text-muted-foreground" />
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex-1">
                                            <Link
                                                href={`/store/product/${item.product.id}/${item.product.slug}`}
                                                className="font-semibold hover:text-primary transition-colors"
                                            >
                                                {item.product.name}
                                            </Link>
                                            {/* The line has to be the number the
                                                till takes. It summed list
                                                prices while the checkout
                                                charged the upgrade price, so a
                                                buyer read one figure here and
                                                was taken a smaller one a click
                                                later. */}
                                            <p className="text-primary font-bold mt-1">
                                                {(item.upgradeCredit ?? 0) > 0 && (
                                                    <span className="mr-1 text-sm font-normal text-muted-foreground line-through">
                                                        {formatPrice(item.product.price)}
                                                    </span>
                                                )}
                                                {formatPrice(item.payPrice ?? item.product.price)}
                                            </p>
                                            {(item.upgradeCredit ?? 0) > 0 && (
                                                <p className="mt-0.5 text-xs font-medium text-success">
                                                    {t("upgradeNote", { amount: (item.upgradeCredit as number).toFixed(2) })}
                                                </p>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                aria-label={t("cart_decreaseQuantity", { name: item.product.name })}
                                                onClick={() => updateQuantity(item.product.id, Math.max(1, item.quantity - 1))}
                                            >
                                                <span aria-hidden="true">-</span>
                                            </Button>
                                            <span className="w-8 text-center">{item.quantity}</span>
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                aria-label={t("cart_increaseQuantity", { name: item.product.name })}
                                                onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                                            >
                                                <span aria-hidden="true">+</span>
                                            </Button>
                                        </div>

                                        <div className="text-right">
                                            <p className="font-bold">
                                                {formatPrice((item.payPrice ?? item.product.price) * item.quantity)}
                                            </p>
                                            <button
                                                onClick={() => removeItem(item.product.id)}
                                                className="text-sm text-destructive hover:underline mt-1"
                                            >
                                                {t('remove')}
                                            </button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}

                        <Button variant="ghost" onClick={clearCart} className="text-muted-foreground">
                            {t('clearCart')}
                        </Button>
                    </div>

                    {/* Order Summary */}
                    <div>
                        <Card className="sticky top-24">
                            <CardHeader>
                                <CardTitle>{t('orderSummary')}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t('items', { count: cart.itemCount })}</span>
                                    <span>{formatPrice(cart.total)}</span>
                                </div>

                                {/* Coupon */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">{t('couponCode')}</label>
                                    {couponApplied ? (
                                        <div className="flex items-center justify-between bg-success/10 border border-success/20 rounded-md px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                <Check className="w-4 h-4 text-success" />
                                                <span className="text-sm font-medium text-success">{couponApplied}</span>
                                            </div>
                                            <button onClick={removeCoupon} aria-label={commonT('remove')}>
                                                <X className="w-4 h-4 text-muted-foreground hover:text-muted-foreground" aria-hidden="true" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2">
                                            <Input
                                                placeholder={t('enterCode')} aria-label={t('enterCode')}
                                                value={couponCode}
                                                onChange={(e) => setCouponCode(e.target.value)}
                                                onKeyDown={(e) => e.key === "Enter" && applyCoupon()}
                                            />
                                            <Button variant="outline" onClick={applyCoupon}>
                                                {t('apply')}
                                            </Button>
                                        </div>
                                    )}
                                    {couponError && (
                                        <p role="alert" className="text-sm text-destructive">{couponError}</p>
                                    )}
                                </div>

                                {/* Creator Code */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">{t('creatorCode')}</label>
                                    {creatorApplied ? (
                                        <div className="flex items-center justify-between bg-primary/10 border border-primary/20 rounded-md px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                <Check className="w-4 h-4 text-primary" />
                                                <span className="text-sm font-medium text-primary">{t("creatorApplied", { code: creatorApplied.code, percent: creatorApplied.discountPercent })}</span>
                                            </div>
                                            <button onClick={removeCreatorCode} aria-label={commonT('remove')}>
                                                <X className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2">
                                            <Input
                                                placeholder={t('creatorCode')} aria-label={t('creatorCode')}
                                                value={creatorCodeInput}
                                                onChange={(e) => setCreatorCodeInput(e.target.value)}
                                                onKeyDown={(e) => e.key === "Enter" && applyCreatorCode()}
                                            />
                                            <Button variant="outline" onClick={applyCreatorCode}>{t('apply')}</Button>
                                        </div>
                                    )}
                                    {creatorError && <p role="alert" className="text-sm text-destructive">{creatorError}</p>}
                                </div>

                                {/* Player Name */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">{t('playerName')} <span className="text-destructive">*</span></label>
                                    <Input
                                        aria-label={t('playerName')}
                                        placeholder={t('playerNamePlaceholder')}
                                        value={playerName}
                                        onChange={(e) => setPlayerName(e.target.value)}
                                        required
                                    />
                                    <p className="text-xs text-muted-foreground">{t('playerNameHelp')}</p>
                                </div>

                                {billingRequired && (
                                    <BillingFields
                                        value={billing}
                                        onChange={(next) => { setBilling(next); setBillingMissing([]); }}
                                        missing={billingMissing}
                                    />
                                )}

                                {couponDiscount > 0 && (
                                    <div className="flex justify-between text-success">
                                        <span>{t('couponDiscount')}</span>
                                        <span>-{formatPrice(couponDiscount)}</span>
                                    </div>
                                )}

                                {creatorApplied && (
                                    <div className="flex justify-between text-primary">
                                        <span>{t('creatorDiscount', { percent: creatorApplied.discountPercent })}</span>
                                        {/* What the endpoint worked out, not
                                            what this page can guess: a code
                                            may cover one shelf, and the browser
                                            does not know which. */}
                                        <span>-{formatPrice(creatorApplied.discount)}</span>
                                    </div>
                                )}

                                <hr className="border-border" />

                                <div className="flex justify-between text-lg font-bold">
                                    <span>{t('total')}</span>
                                    <span className="text-primary">{formatPrice(
                                        Math.max(0, cart.total - couponDiscount - (creatorApplied?.discount ?? 0))
                                    )}</span>
                                </div>

                                {/* Payment Method */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">{t('paymentMethod')}</label>
                                    <div className="grid gap-2">
                                        {providers.map((provider) => (
                                            <button
                                                key={provider.id}
                                                type="button"
                                                onClick={() => setPaymentMethod(provider.id)}
                                                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                                                    paymentMethod === provider.id
                                                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                                                        : "border-border hover:border-muted-foreground"
                                                }`}
                                            >
                                                <ProviderIcon name={provider.icon} />
                                                <div className="flex-1">
                                                    <span className="text-sm font-medium">{provider.label}</span>
                                                    {provider.description && (
                                                        <p className="text-xs text-muted-foreground">{provider.description}</p>
                                                    )}
                                                </div>
                                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                                    paymentMethod === provider.id ? "border-primary" : "border-muted-foreground"
                                                }`}>
                                                    {paymentMethod === provider.id && <div className="w-2 h-2 rounded-full bg-primary" />}
                                                </div>
                                            </button>
                                        ))}
                                        {creditsAvailable && (
                                            <button
                                                type="button"
                                                onClick={() => setPaymentMethod("credits")}
                                                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                                                    paymentMethod === "credits"
                                                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                                                        : "border-border hover:border-muted-foreground"
                                                }`}
                                            >
                                                <Coins className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                                                <div className="flex-1">
                                                    <span className="text-sm font-medium">{t('payWithCredits')}</span>
                                                    <p className="text-xs text-muted-foreground">
                                                        {t('balance', { amount: formatPrice(creditBalance) })}
                                                        {cart && creditBalance < Math.max(0, cart.total - couponDiscount - (creatorApplied?.discount ?? 0)) && (
                                                            <span className="text-destructive">({t('insufficient')})</span>
                                                        )}
                                                    </p>
                                                </div>
                                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                                    paymentMethod === "credits" ? "border-primary" : "border-muted-foreground"
                                                }`}>
                                                    {paymentMethod === "credits" && <div className="w-2 h-2 rounded-full bg-primary" />}
                                                </div>
                                            </button>
                                        )}
                                        {providers.length === 0 && !creditsAvailable && (
                                            <p className="text-sm text-muted-foreground">{t('noPaymentMethods')}</p>
                                        )}
                                    </div>
                                </div>

                                {checkoutError && (
                                    <p role="alert" className="text-sm text-destructive text-center">{checkoutError}</p>
                                )}

                                <Button
                                    className="w-full"
                                    size="lg"
                                    onClick={handleCheckout}
                                    disabled={checkingOut || !playerName.trim() || !paymentMethod}
                                >
                                    {checkingOut ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> {t('processing')}</>
                                    ) : (
                                        t('proceedToCheckout')
                                    )}
                                </Button>

                                <p className="text-xs text-muted-foreground text-center">
                                    {t('secureCheckout')}
                                </p>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}
        </PageFrame>
    );
}
