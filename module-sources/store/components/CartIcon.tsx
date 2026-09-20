"use client";

import { useCallback, useEffect, useState } from "react";
import { ShoppingCart } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/core/sdk/navigation";
import { CountBadge } from "@/core/sdk/ui";
import { useSession } from "next-auth/react";

export function CartIcon() {
    const { data: session } = useSession();
    const t = useTranslations("store");
    const [count, setCount] = useState(0);

    const refresh = useCallback(() => {
        if (!session?.user) return;
        fetch("/api/v1/store/cart")
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setCount(d.itemCount || 0); })
            .catch(() => {});
    }, [session]);

    useEffect(() => { refresh(); }, [refresh]);

    // Other components (product page add-to-cart, cart page) dispatch this
    // event so the navbar badge updates immediately without a full reload.
    useEffect(() => {
        const onUpdate = () => refresh();
        window.addEventListener("cart:updated", onUpdate);
        return () => window.removeEventListener("cart:updated", onUpdate);
    }, [refresh]);

    if (!session?.user) return null;

    // The number is drawn on the corner of the icon and `CountBadge` hides it
    // from the accessible tree, because a bare "3" beside "Cart" is a second
    // thing to work out rather than a fact. It belongs in the link's own name:
    // without this, somebody listening to the page is told there is a cart and
    // never that anything is in it.
    const ariaLabel = count > 0 ? t("cartAriaLabelCounted", { count }) : t("cartAriaLabel");

    return (
        <Link
            href="/store/cart"
            aria-label={ariaLabel}
            className="relative p-2 rounded-md text-muted-foreground hover:text-muted-foreground hover:bg-muted transition-colors"
        >
            <ShoppingCart className="w-4 h-4" />
            <CountBadge count={count} tone="primary" />
        </Link>
    );
}

export default CartIcon;
