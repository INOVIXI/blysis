"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";
import { RARITIES, rewardChance, rewardHandsSomethingOver } from "../../../lib/crates";

interface RewardRow {
    crateId?: unknown;
    kind?: unknown;
    productId?: unknown;
    value?: unknown;
    weight?: unknown;
    isActive?: unknown;
}

/** Whether a row is one the draw can land on, by the rule the opening uses. */
function drawable(row: RewardRow): boolean {
    return row.isActive !== false
        && Number(row.weight ?? 0) > 0
        && rewardHandsSomethingOver({ kind: String(row.kind ?? ""), productId: row.productId as string | null, value: Number(row.value ?? 0) });
}

/**
 * The rewards in the site's crates.
 *
 * Each row says which crate, what it is and the chance it really has - the
 * published figure members read, worked out the way the opening draws - so an
 * operator tuning one weight sees every other reward's chance move with it.
 */
export default function Page() {
    const t = useTranslations("crates");
    const [crateNames, setCrateNames] = useState<Record<string, string>>({});
    const [rewards, setRewards] = useState<RewardRow[]>([]);

    const read = useCallback(async () => {
        try {
            const [crates, all] = await Promise.all([
                fetch("/api/v1/crates/admin/crates").then((r) => (r.ok ? r.json() : null)),
                fetch("/api/v1/crates/admin/rewards").then((r) => (r.ok ? r.json() : null)),
            ]);
            const names: Record<string, string> = {};
            for (const crate of (crates?.crates ?? []) as { id: string; name: string }[]) names[crate.id] = crate.name;
            setCrateNames(names);
            setRewards((all?.rewards ?? []) as RewardRow[]);
        } catch {
            // Only decorates the rows; the list below says when its own read failed.
        }
    }, []);

    useEffect(() => { void read(); }, [read]);

    const kindLabel = (row: RewardRow) => {
        const kind = String(row.kind ?? "");
        if (kind === "product" && !row.productId) return t("adm_rewardNoProduct");
        return t.has(`kind_${kind}`) ? t(`kind_${kind}`) : kind;
    };

    return (
        <AdminCrudPage
            title={t("adm_rewards_title")}
            subtitle={t("adm_rewards_subtitle")}
            apiPath="/api/v1/crates/admin/rewards"
            listKey="rewards"
            displayField="name"
            secondaryRender={(item) => {
                const row = item as RewardRow;
                const live = rewards.filter((one) => one.crateId === row.crateId && drawable(one));
                const chance = drawable(row)
                    ? rewardChance(live.map((one) => ({ weight: Number(one.weight ?? 0) })), { weight: Number(row.weight ?? 0) })
                    : 0;
                return t("adm_rewardRow", {
                    crate: crateNames[String(row.crateId ?? "")] ?? "",
                    kind: kindLabel(row),
                    chance: Math.round(chance * 100) / 100,
                });
            }}
            fields={[
                { key: "name", label: t("adm_rewards_name"), required: true, placeholder: t("adm_rewards_namePlaceholder") },
                {
                    key: "crateId",
                    label: t("adm_rewards_crate"),
                    type: "reference",
                    required: true,
                    placeholder: t("adm_rewards_cratePlaceholder"),
                    reference: { endpoint: "/api/v1/crates/admin/crates", listKey: "crates", labelField: "name", hintField: "slug" },
                },
                {
                    key: "kind",
                    label: t("adm_rewards_kind"),
                    type: "select",
                    required: true,
                    defaultValue: "credits",
                    options: [
                        { value: "credits", label: t("kind_credits") },
                        { value: "product", label: t("kind_product") },
                        { value: "nothing", label: t("kind_nothing") },
                    ],
                },
                {
                    key: "productId",
                    label: t("adm_rewards_product"),
                    type: "reference",
                    placeholder: t("adm_rewards_productPlaceholder"),
                    description: t("adm_rewards_productHint"),
                    reference: { endpoint: "/api/v1/crates/admin/grantables", listKey: "grantables", labelField: "label", hintField: "hint" },
                },
                { key: "value", label: t("adm_rewards_value"), type: "number", defaultValue: "0", description: t("adm_rewards_valueHint") },
                { key: "weight", label: t("adm_rewards_weight"), type: "number", defaultValue: "10", description: t("adm_rewards_weightHint") },
                {
                    key: "rarity",
                    label: t("adm_rewards_rarity"),
                    type: "select",
                    defaultValue: "common",
                    options: RARITIES.map((value) => ({ value, label: t(`rarity_${value}`) })),
                },
                { key: "order", label: t("adm_rewards_order"), type: "number", defaultValue: "0" },
                { key: "isActive", label: t("adm_rewards_active"), type: "toggle", defaultValue: "true" },
            ]}
        />
    );
}
