"use client";

import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";

export default function Page() {
    const t = useTranslations("store");
    return (
        <AdminCrudPage
            title={t("cc_title")}
            subtitle={t("cc_subtitle")}
            apiPath="/api/v1/creator-codes"
            listKey="codes"
            displayField="code"
            secondaryRender={(item) => {
                const discount = Number(item.discountPercent ?? 0);
                const commission = Number(item.commissionPercent ?? 0);
                // Both numbers and where they apply, in words somebody wrote:
                // the row said "5% off · 5% commission" in English, in the
                // source, on whatever language the panel was in.
                const products = (item.productIds as string[] | undefined)?.length ?? 0;
                const categories = (item.categoryIds as string[] | undefined)?.length ?? 0;
                const where = products + categories === 0
                    ? t("cc_scopeEverything")
                    : t("cc_scopeCount", { products, categories });
                return `${t("cc_rowSummary", { discount, commission })} · ${where}`;
            }}
            fields={[
                { key: "code", label: t("cc_codeLabel"), required: true, placeholder: t("cc_codePlaceholder") },
                /*
                 * The endpoint already joins the creator's username, so
                 * editing an existing code shows the name without asking for
                 * it again.
                 */
                {
                    key: "creatorId",
                    label: t("cc_creatorIdLabel"),
                    type: "reference",
                    required: true,
                    placeholder: t("cc_creatorIdPlaceholder"),
                    reference: {
                        endpoint: "/api/v1/users",
                        listKey: "users",
                        labelField: "username",
                        hintField: "email",
                        labelFromRow: (row) => (row.creator as { username?: string } | undefined)?.username,
                    },
                },
                { key: "discountPercent", label: t("cc_discountPercentLabel"), type: "number", placeholder: t("cc_discountPercentPlaceholder"), defaultValue: "5" },
                { key: "commissionPercent", label: t("cc_commissionPercentLabel"), type: "number", placeholder: t("cc_commissionPercentPlaceholder"), defaultValue: "5" },
                /*
                 * Where the code works. Nothing named is every product, which
                 * is what every code written before this meant - so a code
                 * already in a creator's video keeps working untouched.
                 */
                {
                    key: "productIds",
                    label: t("cc_productsLabel"),
                    type: "referenceList",
                    placeholder: t("cc_productsPlaceholder"),
                    description: t("cc_scopeHint"),
                    reference: {
                        endpoint: "/api/v1/store/admin/products",
                        listKey: "products",
                        labelField: "name",
                        hintField: "slug",
                    },
                },
                {
                    key: "categoryIds",
                    label: t("cc_categoriesLabel"),
                    type: "referenceList",
                    placeholder: t("cc_categoriesPlaceholder"),
                    reference: {
                        endpoint: "/api/v1/store/categories",
                        listKey: "categories",
                        labelField: "name",
                        hintField: "slug",
                    },
                },
                { key: "isActive", label: t("cc_isActiveLabel"), type: "toggle", defaultValue: "true" },
            ]}
        />
    );
}
