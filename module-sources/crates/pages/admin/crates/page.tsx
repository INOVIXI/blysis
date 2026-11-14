"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";
import { CRATE_PERIODS } from "../../../lib/crates";

/**
 * The crates a site runs.
 *
 * A crate is sold for credits, for a key bought in the store, or both. The key
 * is an ordinary store product, picked here from what the store offers, so it
 * is priced, discounted, paid for and refunded wherever the store does those.
 */
export default function Page() {
    const t = useTranslations("crates");
    const [roles, setRoles] = useState<{ value: string; label: string }[]>([]);

    useEffect(() => {
        fetch("/api/v1/roles")
            .then((res) => { if (!res.ok) throw new Error("load failed"); return res.json(); })
            .then((data) => {
                const rows = (data.roles ?? data ?? []) as { id: string; displayName?: string; name: string }[];
                setRoles(rows.map((role) => ({ value: role.id, label: role.displayName || role.name })));
            })
            .catch(() => { /* no roles offered: the crate is open to everyone, which is the default */ });
    }, []);

    return (
        <AdminCrudPage
            title={t("adm_crates_title")}
            subtitle={t("adm_crates_subtitle")}
            apiPath="/api/v1/crates/admin/crates"
            listKey="crates"
            displayField="name"
            secondaryField="slug"
            fields={[
                { key: "name", label: t("adm_crates_name"), required: true, placeholder: t("adm_crates_namePlaceholder") },
                { key: "slug", label: t("adm_crates_slug"), required: true, placeholder: "starter-crate" },
                { key: "description", label: t("adm_crates_description"), type: "textarea" },
                { key: "image", label: t("adm_crates_image"), type: "image" },
                { key: "cost", label: t("adm_crates_cost"), type: "number", defaultValue: "0", description: t("adm_crates_costHint"), group: t("adm_crates_groupPay") },
                {
                    key: "keyProductId",
                    label: t("adm_crates_key"),
                    type: "reference",
                    placeholder: t("adm_crates_keyPlaceholder"),
                    description: t("adm_crates_keyHint"),
                    group: t("adm_crates_groupPay"),
                    reference: {
                        endpoint: "/api/v1/crates/admin/grantables",
                        listKey: "grantables",
                        labelField: "label",
                        hintField: "hint",
                    },
                },
                { key: "perPersonLimit", label: t("adm_crates_limit"), type: "number", defaultValue: "0", description: t("adm_crates_limitHint"), group: t("adm_crates_groupWho") },
                {
                    key: "perPersonPeriod",
                    label: t("adm_crates_period"),
                    type: "select",
                    defaultValue: "day",
                    group: t("adm_crates_groupWho"),
                    options: CRATE_PERIODS.map((value) => ({ value, label: t(`period_${value}`) })),
                },
                {
                    key: "roleId",
                    label: t("adm_crates_role"),
                    type: "select",
                    defaultValue: "",
                    group: t("adm_crates_groupWho"),
                    options: [{ value: "", label: t("adm_crates_roleEveryone") }, ...roles],
                },
                { key: "order", label: t("adm_crates_order"), type: "number", defaultValue: "0" },
                { key: "isActive", label: t("adm_crates_active"), type: "toggle", defaultValue: "true" },
            ]}
        />
    );
}
