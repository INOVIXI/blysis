"use client";

import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";

export default function Page() {
    const t = useTranslations("tickets");
    return (
        <AdminCrudPage
            title={t("adm_title")}
            subtitle={t("adm_subtitle")}
            apiPath="/api/v1/tickets/departments"
            listKey="departments"
            displayField="name"
            secondaryField="description"
            rowHref={(item) => `/admin/tickets/departments/${item.id}`}
            rowActionLabel={t("adm_setupTitle")}
            fields={[
                { key: "name", label: t("adm_field1Label"), type: "translatable", required: true, placeholder: t("adm_field1Placeholder") },
                { key: "description", label: t("adm_field2Label"), type: "translatable", placeholder: t("adm_field2Placeholder") },
                { key: "color", label: t("adm_field3Label"), type: "color", defaultValue: "#3b82f6" },
                { key: "order", label: t("adm_field4Label"), type: "number", placeholder: t("adm_field3Placeholder"), defaultValue: "0" },
                { key: "isActive", label: t("adm_field5Label"), type: "toggle", defaultValue: "true" },
            ]}
        />
    );
}
