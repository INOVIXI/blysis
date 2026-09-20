"use client";

import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";

export default function Page() {
    const t = useTranslations("store");
    return (
        <AdminCrudPage
            title={t("bd_title")}
            subtitle={t("bd_subtitle")}
            apiPath="/api/v1/bulk-discounts"
            listKey="discounts"
            displayField="name"
            secondaryRender={(item) => {
                const min = Number(item.minQuantity ?? 0);
                const pct = Number(item.discountPercent ?? 0);
                // Where it applies, on the row. Two rules reading "3+ → 10%"
                // with nothing else between them are two rules an operator
                // cannot tell apart on the screen that lists them.
                const products = (item.productIds as string[] | undefined)?.length ?? 0;
                const categories = (item.categoryIds as string[] | undefined)?.length ?? 0;
                const where = products + categories === 0
                    ? t("bd_scopeEverything")
                    : t("bd_scopeCount", { products, categories });
                return `${min}+ → ${pct}% · ${where}`;
            }}
            fields={[
                { key: "name", label: t("bd_nameLabel"), required: true, placeholder: t("bd_namePlaceholder") },
                { key: "minQuantity", label: t("bd_minQuantityLabel"), type: "number", required: true, placeholder: t("bd_minQuantityPlaceholder") },
                { key: "discountPercent", label: t("bd_discountPercentLabel"), type: "number", required: true, placeholder: t("bd_discountPercentPlaceholder") },
                /*
                 * Picked, not typed, and as many as the offer covers. Nothing
                 * in the panel shows a product's id or a category's, so these
                 * boxes could only be filled from the database - and a
                 * mistyped id is refused by nothing: it makes a discount that
                 * never applies to anything. One each was also a wall: "buy
                 * three of any rank" was sayable and "any of these three
                 * ranks" was not.
                 */
                {
                    key: "productIds",
                    label: t("bd_productsLabel"),
                    type: "referenceList",
                    placeholder: t("bd_productsPlaceholder"),
                    description: t("bd_scopeHint"),
                    reference: {
                        endpoint: "/api/v1/store/admin/products",
                        listKey: "products",
                        labelField: "name",
                        hintField: "slug",
                    },
                },
                {
                    key: "categoryIds",
                    label: t("bd_categoriesLabel"),
                    type: "referenceList",
                    placeholder: t("bd_categoriesPlaceholder"),
                    reference: {
                        endpoint: "/api/v1/store/categories",
                        listKey: "categories",
                        labelField: "name",
                        hintField: "slug",
                    },
                },
                { key: "isActive", label: t("bd_isActiveLabel"), type: "toggle", defaultValue: "true" },
            ]}
        />
    );
}
