"use client";

import { useTranslations } from "next-intl";
import { SettingsForm } from "@/core/sdk/admin";
import { ACTIVE_EMAIL_PROVIDER_KEY, emailProviders } from "@/core/sdk";

export default function ResendSettingsPage() {
    const t = useTranslations("resendProvider");
    return (
        <SettingsForm
            title={t("adm_title")}
            subtitle={t("adm_subtitle")}
            fields={[
                /* Which transport actually sends. One installed needs no
                   answer - see core's mailer - so this only decides anything
                   on a site with more than one. */
                {
                    key: ACTIVE_EMAIL_PROVIDER_KEY,
                    label: t("adm_activeLabel"),
                    type: "select",
                    options: emailProviders.map((one) => ({ value: one.id, label: one.name })),
                    description: t("adm_activeDesc"),
                },
                { key: "resend_api_key", label: t("adm_field1Label"), type: "password", placeholder: "re_...", description: t("adm_field1Desc") },
                { key: "email_from", label: t("adm_field2Label"), type: "email", placeholder: "noreply@yoursite.com", description: t("adm_field2Desc") },
                { key: "email_from_name", label: t("adm_field3Label"), placeholder: "Blysis", description: t("adm_field3Desc") },
            ]}
        />
    );
}
