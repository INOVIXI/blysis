"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";
import { prizeChance, prizeIsGrantable } from "../../../lib/wheels";

interface PrizeRow {
    probability?: unknown;
    isActive?: unknown;
    wheelId?: unknown;
    type?: unknown;
}

/**
 * The prizes on the site's wheels.
 *
 * The screen had no wheel field, so every prize an operator wrote joined
 * whichever wheel came first - and the update route never read `wheelId`, so
 * nothing could move it afterwards. A site built to run several wheels could
 * fill exactly one of them, and the row did not say which.
 *
 * The row says three things now: which wheel, what the prize is, and how
 * often it really comes up. The last is not the number in the box - the draw
 * adds the weights and takes a share - and the search strip reads the row's
 * second line, so typing a wheel's name narrows the list to that wheel.
 */
export default function Page() {
    const t = useTranslations("wheel");
    const [wheelNames, setWheelNames] = useState<Record<string, string>>({});
    const [prizes, setPrizes] = useState<PrizeRow[]>([]);

    const read = useCallback(async () => {
        try {
            const [wheels, all] = await Promise.all([
                fetch("/api/v1/wheel/admin/wheels").then((r) => (r.ok ? r.json() : null)),
                fetch("/api/v1/wheel/prizes").then((r) => (r.ok ? r.json() : null)),
            ]);
            const names: Record<string, string> = {};
            for (const wheel of (wheels?.wheels ?? []) as { id: string; name: string }[]) {
                names[wheel.id] = wheel.name;
            }
            setWheelNames(names);
            setPrizes((all?.prizes ?? []) as PrizeRow[]);
        } catch {
            // The shell below draws the list and says when its own read
            // failed; this one only decorates the rows, so a failure here
            // leaves them undecorated rather than empty.
        }
    }, []);

    useEffect(() => { void read(); }, [read]);

    /*
     * What the prize is, and a warning where it is nothing the wheel can
     * hand over. The spin grants credits and mints a coupon and does nothing
     * for any other kind, so a prize of one is drawn, logged, announced and
     * never received - the row says so rather than leaving an operator to
     * find out from a complaint.
     */
    const kindLabel = (type: unknown) => {
        const kind = String(type ?? "");
        if (!prizeIsGrantable(kind)) return t("adm_prizeUnbound");
        const key = `adm_prizeKind_${kind}`;
        return t.has(key) ? t(key) : kind;
    };

    return (
        <AdminCrudPage
            title={t("adm_title")}
            subtitle={t("adm_subtitle")}
            apiPath="/api/v1/wheel/prizes"
            listKey="prizes"
            displayField="name"
            secondaryRender={(item) => {
                const row = item as PrizeRow;
                const wheel = wheelNames[String(row.wheelId ?? "")] ?? t("adm_prizeNoWheel");
                const chance = prizes.length > 0
                    ? prizeChance(
                        prizes
                            .filter((one) => one.wheelId === row.wheelId)
                            .map((one) => ({ probability: Number(one.probability ?? 0), isActive: one.isActive !== false })),
                        { probability: Number(row.probability ?? 0), isActive: row.isActive !== false },
                    )
                    : 0;
                return t("adm_prizeRow", {
                    wheel,
                    kind: kindLabel(row.type),
                    chance: Math.round(chance * 10) / 10,
                });
            }}
            fields={[
                { key: "name", label: t("adm_field1Label"), required: true, placeholder: t("adm_field1Placeholder") },
                /*
                 * Which wheel it is on. Picked, not typed: nothing in the
                 * panel shows a wheel's id, and a prize pointing at nothing is
                 * a prize nobody can win.
                 */
                {
                    key: "wheelId",
                    label: t("adm_wheelLabel"),
                    type: "reference",
                    required: true,
                    placeholder: t("adm_wheelPlaceholder"),
                    reference: {
                        endpoint: "/api/v1/wheel/admin/wheels",
                        listKey: "wheels",
                        labelField: "name",
                        hintField: "slug",
                    },
                },
                { key: "type", label: t("adm_field2Label"), type: "select", required: true, options: [
                    { value: "credits", label: t("adm_prizeKind_credits") },
                    { value: "coupon", label: t("adm_prizeKind_coupon") },
                    { value: "nothing", label: t("adm_prizeKind_nothing") },
                ], defaultValue: "credits" },
                { key: "value", label: t("adm_field6Label"), type: "number", placeholder: t("adm_field2Placeholder"), defaultValue: "0" },
                { key: "color", label: t("adm_field7Label"), type: "color", defaultValue: "#3b82f6" },
                {
                    key: "probability",
                    label: t("adm_field8Label"),
                    type: "number",
                    placeholder: t("adm_field3Placeholder"),
                    description: t("adm_oddsHint"),
                    defaultValue: "10",
                },
                { key: "isActive", label: t("adm_field9Label"), type: "toggle", defaultValue: "true" },
            ]}
        />
    );
}
