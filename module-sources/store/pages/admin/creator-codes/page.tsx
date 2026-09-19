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
                return `${discount}% off · ${commission}% commission`;
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
                { key: "isActive", label: t("cc_isActiveLabel"), type: "toggle", defaultValue: "true" },
            ]}
        />
    );
}
