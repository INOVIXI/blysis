"use client";

import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/components/admin/AdminCrudPage";

/**
 * The reasons a moderator picks from when rejecting.
 *
 * The five shipped ones read the catalogue's wording until the admin types
 * their own, so their name field may be left empty; the API refuses an empty
 * name on a reason of the site's own. Neither a shipped reason nor one a
 * decision already gave can be deleted, only switched off: the refusal says
 * which, through `err.reason_shipped` and `err.reason_in_use`.
 */
export default function ModerationReasonsPage() {
    const t = useTranslations("admin");
    return (
        <AdminCrudPage
            title={t("moderationReasons_title")}
            subtitle={t("moderationReasons_subtitle")}
            apiPath="/api/v1/admin/moderation/reasons"
            listKey="reasons"
            displayField="displayLabel"
            activeField="enabled"
            fields={[
                {
                    key: "label",
                    label: t("moderationReasons_labelLabel"),
                    type: "translatable",
                    description: t("moderationReasons_labelHint"),
                },
                {
                    key: "position",
                    label: t("moderationReasons_positionLabel"),
                    type: "number",
                    defaultValue: "0",
                    description: t("moderationReasons_positionHint"),
                },
                {
                    key: "enabled",
                    label: t("moderationReasons_enabledLabel"),
                    type: "toggle",
                    defaultValue: "true",
                    description: t("moderationReasons_enabledHint"),
                },
            ]}
        />
    );
}
