"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/core/sdk/navigation";
import { Button, Card, CardContent, buttonClassName } from "@/core/sdk/ui";
import { Footer, Navbar } from "@/core/sdk/layout";
import { ThemeComponentSlot } from "@/core/sdk/theme";
import { CheckCircle, ShoppingBag, ArrowRight } from "lucide-react";
import { ThankYouCouponNote, type ThankYouCouponJson } from "../../../components/ThankYouCouponNote";

export default function OrderSuccessPage() {
    const t = useTranslations("store");
    const [coupon, setCoupon] = useState<ThankYouCouponJson | null>(null);

    // The page a gateway returns the buyer to names no order, so it asks for
    // their newest one. A webhook that has not landed yet means no coupon
    // here; the email and the order list carry it once it does.
    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/store/orders?limit=1")
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                const found = data?.orders?.[0]?.thankYouCoupon as ThankYouCouponJson | null | undefined;
                if (!cancelled && found && found.standing === "live") setCoupon(found);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    return (
        <div className="min-h-screen flex flex-col bg-muted">
            <ThemeComponentSlot name="Hero" />
            <Navbar />

            <main className="container mx-auto px-4 py-12 flex-1 flex items-center justify-center">
                <Card className="max-w-md w-full">
                    <CardContent className="p-8 text-center">
                        <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-6">
                            <CheckCircle className="w-8 h-8 text-success" />
                        </div>

                        <h1 className="text-2xl font-bold text-foreground mb-2">{t("orderSuccess_title")}</h1>
                        <p className="text-muted-foreground mb-8">
                            {t("orderSuccess_body")}
                        </p>

                        {coupon && (
                            <div className="text-left mb-8 -mt-5">
                                <ThankYouCouponNote coupon={coupon} />
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row gap-3 justify-center">
                            <Link href="/profile" className={buttonClassName("outline", "default")}>
                                    <ShoppingBag className="w-4 h-4" /> {t("orderSuccess_myOrders")}
                                </Link>
                            <Link href="/store" className={buttonClassName("default", "default")}>
                                    {t("orderSuccess_continue")} <ArrowRight className="w-4 h-4" />
                                </Link>
                        </div>
                    </CardContent>
                </Card>
            </main>

            <Footer />
        </div>
    );
}
