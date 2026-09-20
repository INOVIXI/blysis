"use client";

import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";

export default function Page() {
    const t = useTranslations("popups");
    return (
        <AdminCrudPage
            title={t("adm_title")}
            subtitle={t("adm_subtitle")}
            apiPath="/api/v1/popups"
            // The operator's answer, not the visitor's: see the endpoint.
            listPath="/api/v1/popups?scope=admin"
            listKey="popups"
            displayField="title"
            secondaryField="content"
            fields={[
                { key: "title", label: t("adm_field1Label"), required: true, placeholder: t("adm_field1Placeholder") },
                { key: "content", label: t("adm_field2Label"), type: "richtext", placeholder: t("adm_field2Placeholder") },
                { key: "image", label: t("adm_field3Label"), type: "image", placeholder: t("adm_field3Placeholder") },
                { key: "link", label: t("adm_field4Label"), type: "url", placeholder: t("adm_field4Placeholder") },
                { key: "linkText", label: t("adm_field5Label"), placeholder: t("adm_field5Placeholder") },
                { key: "isActive", label: t("adm_field6Label"), type: "toggle", defaultValue: "true" },
                { key: "startsAt", label: t("adm_field7Label"), type: "datetime" },
                { key: "endsAt", label: t("adm_field8Label"), type: "datetime" },
            ]}
        />
    );
}
