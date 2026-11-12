"use client";

import { useTranslations } from "next-intl";
import { SettingsForm } from "@/core/sdk/admin";

export default function GoalsSettingsPage() {
    const t = useTranslations("store");
    return (
        <SettingsForm
            title={t("adm_title")}
            subtitle={t("adm_subtitle")}
            fields={[
                { key: "community_goal_title", label: t("adm_field1Label"), type: "translatable", placeholder: t("adm_goalTitlePlaceholder"), description: t("adm_field1Desc") },
                { key: "community_goal_target", label: t("adm_field2Label"), type: "number", placeholder: "5000", description: t("adm_field2Desc") },
                { key: "community_goal_end_date", label: t("adm_field3Label"), type: "date", placeholder: "2026-12-31", description: t("adm_field3Desc") },
            ]}
        />
    );
}
