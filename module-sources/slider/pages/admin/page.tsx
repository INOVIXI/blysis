"use client";

import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";

export default function Page() {
    const t = useTranslations("slider");
    return (
        <AdminCrudPage
            title={t("adm_title")}
            subtitle={t("adm_subtitle")}
            apiPath="/api/v1/slider"
            listPath="/api/v1/slider?scope=admin"
            listKey="items"
            displayField="title"
            secondaryField="image"
            fields={[
                { key: "title", label: t("adm_field1Label"), type: "translatable", placeholder: t("adm_field1Placeholder") },
                { key: "subtitle", label: t("adm_field2Label"), type: "translatable", placeholder: t("adm_field2Placeholder") },
                { key: "image", label: t("adm_field3Label"), type: "image", required: true, placeholder: t("adm_field3Placeholder") },
                { key: "link", label: t("adm_field4Label"), type: "url", placeholder: t("adm_field4Placeholder") },
                { key: "order", label: t("adm_field5Label"), type: "number", defaultValue: "0" },
                { key: "isActive", label: t("adm_field6Label"), type: "toggle", defaultValue: "true" },
            ]}
        />
    );
}
