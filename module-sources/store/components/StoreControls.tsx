"use client";

import { useState } from "react";
import { useRouter } from "@/core/sdk/navigation";
import { useTranslations } from "next-intl";
import { NativeSelect } from "@/core/sdk/ui";
import { Search, X } from "lucide-react";

/**
 * The two controls that change what the shop is showing.
 *
 * Both used to be client state, which is why no view of the shop had an
 * address: a section could not be linked to and a sort could not be shared.
 * They write to the query string now and the server reads it back.
 */
export function StoreSearch({ initial, category }: { initial: string; category?: string }) {
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const router = useRouter();
    const [value, setValue] = useState(initial);

    const go = (term: string) => {
        const query = new URLSearchParams();
        if (term) query.set("q", term);
        else if (category) query.set("category", category);
        const qs = query.toString();
        router.push(qs ? `/store?${qs}` : "/store");
    };

    return (
        <form
            role="search"
            onSubmit={(event) => { event.preventDefault(); go(value.trim()); }}
            className="mb-6"
        >
            <div className="relative max-w-lg">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" aria-hidden="true" />
                <input
                    type="search"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={t("searchProducts")}
                    aria-label={t("searchProducts")}
                    style={{ paddingLeft: "2.5rem", paddingRight: "2.5rem" }}
                    className="w-full py-2.5 bg-card border border-border rounded-lg text-sm focus:outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary"
                />
                {value && (
                    <button
                        type="button"
                        onClick={() => { setValue(""); go(""); }}
                        aria-label={commonT("close")}
                        className="absolute right-3 top-1/2 -translate-y-1/2"
                    >
                        <X className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    </button>
                )}
            </div>
        </form>
    );
}

export function StoreSort({ value, category, search }: { value: string; category?: string; search?: string }) {
    const t = useTranslations("store");
    const router = useRouter();

    return (
        <NativeSelect
            value={value}
            aria-label={t("sortBy")}
            inputSize="sm"
            onChange={(event) => {
                const query = new URLSearchParams();
                if (category) query.set("category", category);
                if (search) query.set("q", search);
                if (event.target.value !== "newest") query.set("sort", event.target.value);
                const qs = query.toString();
                router.push(qs ? `/store?${qs}` : "/store");
            }}
        >
            <option value="newest">{t("newest")}</option>
            <option value="price_asc">{t("priceLowHigh")}</option>
            <option value="price_desc">{t("priceHighLow")}</option>
            <option value="popular">{t("mostPopular")}</option>
        </NativeSelect>
    );
}
