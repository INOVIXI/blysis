"use client";

import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";

/**
 * Nine fields in declaration order, which is how they used to be drawn: what
 * the announcement says, then whether it can be dismissed, then the paths it
 * appears on, then the dates. Nothing said which of them answered the same
 * question, so the form read as nine unrelated boxes - and the keys behind
 * them were `adm_field1Label` through `adm_field13Label`, numbered in the
 * order somebody happened to add them rather than named for what they hold,
 * so `adm_field3Placeholder` was the hint under the paths field and
 * `adm_field4Placeholder` the hint under the one after it.
 *
 * The fields are in three groups now and the keys say what they are. The
 * hints moved out of the placeholders, which vanish the moment an operator
 * starts typing - which is exactly when the sentence explaining the wildcard
 * is wanted.
 */
export default function Page() {
    const t = useTranslations("announcements");
    return (
        <AdminCrudPage
            title={t("adm_title")}
            subtitle={t("adm_subtitle")}
            apiPath="/api/v1/announcements"
            // The operator's answer, not the reader's: a notice switched off
            // is a notice this screen has to be able to switch back on.
            listPath="/api/v1/announcements/admin"
            listKey="announcements"
            displayField="title"
            secondaryField="type"
            fields={[
                { key: "title", label: t("adm_titleLabel"), required: true, placeholder: t("adm_titlePlaceholder") },
                { key: "content", label: t("adm_contentLabel"), type: "textarea", required: true, placeholder: t("adm_contentPlaceholder") },
                { key: "type", label: t("adm_typeLabel"), type: "select", options: [
                    { value: "info", label: t("adm_typeInfo") },
                    { value: "warning", label: t("adm_typeWarning") },
                    { value: "success", label: t("adm_typeSuccess") },
                    { value: "error", label: t("adm_typeError") },
                ], defaultValue: "info" },

                { key: "includePages", group: t("adm_whereGroup"), label: t("adm_includePagesLabel"), placeholder: t("adm_includePagesPlaceholder"), description: t("adm_includePagesHint") },
                { key: "excludePages", group: t("adm_whereGroup"), label: t("adm_excludePagesLabel"), placeholder: t("adm_excludePagesPlaceholder"), description: t("adm_excludePagesHint") },

                { key: "startsAt", group: t("adm_whenGroup"), label: t("adm_startsAtLabel"), type: "datetime", description: t("adm_startsAtHint") },
                { key: "endsAt", group: t("adm_whenGroup"), label: t("adm_endsAtLabel"), type: "datetime", description: t("adm_endsAtHint") },

                { key: "isActive", group: t("adm_behaviourGroup"), label: t("adm_activeLabel"), type: "toggle", defaultValue: "true" },
                { key: "dismissible", group: t("adm_behaviourGroup"), label: t("adm_dismissibleLabel"), type: "toggle", defaultValue: "true", description: t("adm_dismissibleHint") },
            ]}
        />
    );
}
