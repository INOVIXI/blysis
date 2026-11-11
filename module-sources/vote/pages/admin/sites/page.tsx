"use client";

import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";

export default function Page() {
    const t = useTranslations("vote");
    return (
        <AdminCrudPage
            title={t("adm_title")}
            subtitle={t("adm_subtitle")}
            apiPath="/api/v1/vote/sites"
            listPath="/api/v1/vote/sites?scope=admin"
            listKey="sites"
            displayField="name"
            secondaryField="url"
            fields={[
                { key: "name", label: t("adm_field1Label"), type: "translatable", required: true, placeholder: t("adm_field1Placeholder") },
                { key: "url", label: t("adm_field2Label"), type: "url", required: true, placeholder: t("adm_field2Placeholder") },
                { key: "icon", label: t("adm_field3Label"), type: "icon", placeholder: t("adm_field3Placeholder") },
                { key: "isActive", label: t("adm_field4Label"), type: "toggle", defaultValue: "true" },
            ]}
        />
    );
}
