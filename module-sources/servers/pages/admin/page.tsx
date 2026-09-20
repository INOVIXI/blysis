"use client";

import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";

export default function Page() {
    const t = useTranslations("servers");
    return (
        <AdminCrudPage
            title={t("adm_title")}
            subtitle={t("adm_subtitle")}
            apiPath="/api/v1/servers"
            // The operator's answer, not the visitor's: see the endpoint.
            listPath="/api/v1/servers?scope=admin"
            listKey="servers"
            displayField="name"
            secondaryField="host"
            fields={[
                { key: "name", label: t("svr_name"), required: true, placeholder: t("svr_namePlaceholder") },
                {
                    key: "type",
                    label: t("svr_type"),
                    type: "select",
                    required: true,
                    defaultValue: "minecraft",
                    options: [
                        { value: "minecraft", label: t("svr_typeMinecraft") },
                        { value: "hytale", label: t("svr_typeHytale") },
                        { value: "fivem", label: t("svr_typeFivem") },
                        { value: "rust", label: t("svr_typeRust") },
                        { value: "ark", label: t("svr_typeArk") },
                        { value: "cs2", label: t("svr_typeCs2") },
                        { value: "csgo", label: t("svr_typeCsgo") },
                        { value: "garrysmod", label: t("svr_typeGarrysmod") },
                        { value: "unturned", label: t("svr_typeUnturned") },
                    ],
                },
                { key: "host", label: t("svr_host"), required: true, placeholder: t("svr_hostPlaceholder") },
                { key: "port", label: t("svr_port"), type: "number", defaultValue: "25565" },
                { key: "queryPort", label: t("svr_queryPort"), type: "number", placeholder: t("svr_queryPortPlaceholder") },
                { key: "rconPort", label: t("svr_rconPort"), type: "number", placeholder: t("svr_rconPortPlaceholder") },
                { key: "rconPassword", label: t("svr_rconPassword"), type: "password", placeholder: t("svr_rconPasswordPlaceholder") },
                { key: "isDefault", label: t("svr_isDefault"), type: "toggle", defaultValue: "false" },
                { key: "isActive", label: t("svr_isActive"), type: "toggle", defaultValue: "true" },
            ]}
        />
    );
}
