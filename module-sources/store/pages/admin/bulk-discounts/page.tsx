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
                return `${min}+ → ${pct}%`;
            }}
            fields={[
                { key: "name", label: t("bd_nameLabel"), required: true, placeholder: t("bd_namePlaceholder") },
                { key: "minQuantity", label: t("bd_minQuantityLabel"), type: "number", required: true, placeholder: t("bd_minQuantityPlaceholder") },
                { key: "discountPercent", label: t("bd_discountPercentLabel"), type: "number", required: true, placeholder: t("bd_discountPercentPlaceholder") },
                /*
                 * Picked, not typed. Nothing in the panel shows a product's id
                 * or a category's, so these two boxes could only be filled
                 * from the database - and a mistyped id is refused by nothing:
                 * it makes a discount that never applies to anything.
                 */
                {
                    key: "productId",
                    label: t("bd_productIdLabel"),
                    type: "reference",
                    placeholder: t("bd_productIdPlaceholder"),
                    reference: {
                        endpoint: "/api/v1/store/admin/products",
                        listKey: "products",
                        labelField: "name",
                        hintField: "slug",
                    },
                },
                {
                    key: "categoryId",
                    label: t("bd_categoryIdLabel"),
                    type: "reference",
                    placeholder: t("bd_categoryIdPlaceholder"),
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
