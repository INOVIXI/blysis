"use client";

import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";
import { CHANGELOG_TYPES, changelogTypeLabel } from "../../lib/types";

export default function Page() {
    const t = useTranslations("changelog");
    return (
        <AdminCrudPage
            title={t("adm_title")}
            subtitle={t("adm_subtitle")}
            apiPath="/api/v1/changelog"
            listKey="entries"
            displayField="title"
            secondaryField="version"
            fields={[
                { key: "version", label: t("adm_field1Label"), required: true, placeholder: t("adm_field1Placeholder") },
                { key: "title", label: t("adm_field2Label"), required: true, placeholder: t("adm_field2Placeholder") },
                { key: "content", label: t("adm_field3Label"), type: "richtext", required: true, placeholder: t("adm_field3Placeholder") },
                // The long form and its picture. Both optional: most releases
                // are one line, and an entry without them keeps its old
                // behaviour - no page, and no link on the timeline.
                { key: "details", label: t("adm_detailsLabel"), type: "richtext", placeholder: t("adm_detailsPlaceholder"), description: t("adm_detailsHelp") },
                { key: "coverImage", label: t("adm_coverLabel"), type: "image", description: t("adm_coverHelp") },
                {
                    key: "type",
                    label: t("adm_field4Label"),
                    type: "select",
                    defaultValue: "feature",
                    // The colour follows the type, so there is no second field
                    // to keep in step with it - and no default that made every
                    // release on the page the same shade of blue.
                    options: CHANGELOG_TYPES.map((value) => ({ value, label: changelogTypeLabel(t, value) })),
                },
            ]}
        />
    );
}
