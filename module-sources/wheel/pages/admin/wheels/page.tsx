"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";
import { WHEEL_COOLDOWNS } from "../../../lib/wheels";

/**
 * The wheels a site runs.
 *
 * There was one wheel and its rules lived in a module setting, which is a
 * reasonable shape for one community and no shape at all for the rest: a free
 * daily wheel for everybody and a weekly one for people who bought a rank are
 * two wheels, not two settings on one.
 *
 * "Who may turn it" is offered as a single role because that is the question
 * an operator actually asks - the column holds a list, so several roles stay
 * possible through the API without a screen nobody needed.
 */
export default function Page() {
    const t = useTranslations("wheel");
    const [roles, setRoles] = useState<{ value: string; label: string }[]>([]);

    useEffect(() => {
        fetch("/api/v1/roles")
            .then((res) => { if (!res.ok) throw new Error("load failed"); return res.json(); })
            .then((data) => {
                const rows = (data.roles ?? data ?? []) as { id: string; displayName?: string; name: string }[];
                setRoles(rows.map((role) => ({ value: role.id, label: role.displayName || role.name })));
            })
            .catch(() => { /* no roles offered: the wheel is open to everyone, which is the default */ });
    }, []);

    return (
        <AdminCrudPage
            title={t("adm_wheels_title")}
            subtitle={t("adm_wheels_subtitle")}
            apiPath="/api/v1/wheel/admin/wheels"
            listKey="wheels"
            displayField="name"
            secondaryField="slug"
            fields={[
                { key: "name", label: t("adm_wheels_name"), type: "translatable", required: true, placeholder: t("adm_wheels_namePlaceholder") },
                { key: "slug", label: t("adm_wheels_slug"), required: true, placeholder: "vip-weekly" },
                { key: "description", label: t("adm_wheels_description"), type: "translatableTextarea" },
                {
                    key: "cooldown",
                    label: t("adm_wheels_cooldown"),
                    type: "select",
                    defaultValue: "daily",
                    options: WHEEL_COOLDOWNS.map((value) => ({ value, label: t(`cooldown_${value}`) })),
                },
                { key: "cooldownHours", label: t("adm_wheels_cooldownHours"), type: "number", defaultValue: "24" },
                { key: "cost", label: t("adm_wheels_cost"), type: "number", defaultValue: "0" },
                {
                    key: "roleId",
                    label: t("adm_wheels_role"),
                    type: "select",
                    defaultValue: "",
                    options: [{ value: "", label: t("adm_wheels_roleEveryone") }, ...roles],
                },
                { key: "order", label: t("adm_wheels_order"), type: "number", defaultValue: "0" },
                { key: "isActive", label: t("adm_wheels_active"), type: "toggle", defaultValue: "true" },
            ]}
        />
    );
}
