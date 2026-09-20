"use client";

import { useTranslations } from "next-intl";
import { SettingsForm } from "@/core/sdk/admin";
import { ACTIVE_EMAIL_PROVIDER_KEY, emailProviders } from "@/core/sdk";

/**
 * The relay this site hands its mail to.
 *
 * The port decides the rest: 465 is encrypted from the first byte, 587 starts
 * in the clear and upgrades. Both are encrypted by the time a password
 * crosses, which is why the switch beside the port says which of the two it
 * is rather than whether to use TLS at all.
 */
export default function SmtpSettingsPage() {
    const t = useTranslations("smtpProvider");
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
                { key: "smtp_host", label: t("adm_hostLabel"), placeholder: "smtp.example.com", description: t("adm_hostDesc") },
                { key: "smtp_port", label: t("adm_portLabel"), type: "number", placeholder: "587", description: t("adm_portDesc") },
                /* A choice rather than a switch, because that is the control
                   this form has and a two-value choice says the same thing -
                   the same call the general settings screen made. */
                {
                    key: "smtp_secure",
                    label: t("adm_secureLabel"),
                    type: "select",
                    defaultValue: "false",
                    options: [
                        { value: "false", label: t("adm_secureOff") },
                        { value: "true", label: t("adm_secureOn") },
                    ],
                    description: t("adm_secureDesc"),
                },
                { key: "smtp_user", label: t("adm_userLabel"), placeholder: "postmaster@example.com", description: t("adm_userDesc") },
                { key: "smtp_password", label: t("adm_passwordLabel"), type: "password", description: t("adm_passwordDesc") },
                { key: "email_from", label: t("adm_fromLabel"), type: "email", placeholder: "noreply@example.com", description: t("adm_fromDesc") },
                { key: "email_from_name", label: t("adm_fromNameLabel"), placeholder: "Blysis", description: t("adm_fromNameDesc") },
            ]}
        />
    );
}
