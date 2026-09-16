"use client";

import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";

export default function Page() {
    const t = useTranslations("downloads");
    return (
        <AdminCrudPage
            title={t("adm_title")}
            subtitle={t("adm_subtitle")}
            apiPath="/api/v1/downloads"
            listKey="downloads"
            displayField="title"
            secondaryField="fileName"
            fields={[
                { key: "title", label: t("adm_field1Label"), required: true, placeholder: t("adm_field1Placeholder") },
                { key: "description", label: t("adm_field2Label"), type: "richtext", placeholder: t("adm_field2Placeholder"), description: t("adm_field2Help") },
                // The guide and its picture. Both optional: most files are a
                // title and a button, and one without them keeps that shape.
                { key: "details", label: t("adm_guideLabel"), type: "richtext", placeholder: t("adm_guidePlaceholder"), description: t("adm_guideHelp") },
                { key: "coverImage", label: t("adm_coverLabel"), type: "image", description: t("adm_coverHelp") },
                { key: "fileName", label: t("adm_field3Label"), required: true, placeholder: t("adm_field3Placeholder") },
                { key: "fileUrl", label: t("adm_field4Label"), type: "file", required: true, placeholder: t("adm_field4Placeholder") },
                { key: "fileSize", label: t("adm_field5Label"), type: "number", placeholder: t("adm_field5Placeholder") },
                { key: "isActive", label: t("adm_field6Label"), type: "toggle", defaultValue: "true" },
            ]}
        />
    );
}
