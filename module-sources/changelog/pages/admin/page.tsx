"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AdminCrudPage } from "@/core/sdk/admin";
import { changelogKindLabel, type ChangelogKind } from "../../lib/types";

export default function Page() {
    const t = useTranslations("changelog");
    /*
     * The kinds this community names, read from the table rather than from an
     * array in the source. Six were written in here, and six is not every
     * community's six; they are managed on a screen of their own now.
     *
     * A read that fails leaves the picker empty rather than offering six
     * words that may no longer be the six - the screen for kinds is where an
     * operator is told what exists.
     */
    const [kinds, setKinds] = useState<ChangelogKind[]>([]);
    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/changelog/types")
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((body) => { if (!cancelled) setKinds(body.types ?? []); })
            .catch((err) => console.error("changelog kinds could not be read", err));
        return () => { cancelled = true; };
    }, []);
    return (
        <AdminCrudPage
            title={t("adm_title")}
            subtitle={t("adm_subtitle")}
            apiPath="/api/v1/changelog"
            listKey="entries"
            displayField="title"
            secondaryField="version"
            fields={[
                { key: "version", label: t("adm_field1Label"), required: true, placeholder: t("adm_field1Placeholder") },
                { key: "title", label: t("adm_field2Label"), required: true, placeholder: t("adm_field2Placeholder") },
                { key: "content", label: t("adm_field3Label"), type: "richtext", required: true, placeholder: t("adm_field3Placeholder") },
                // The long form and its picture. Both optional: most releases
                // are one line, and an entry without them keeps its old
                // behaviour - no page, and no link on the timeline.
                { key: "details", label: t("adm_detailsLabel"), type: "richtext", placeholder: t("adm_detailsPlaceholder"), description: t("adm_detailsHelp") },
                { key: "coverImage", label: t("adm_coverLabel"), type: "image", description: t("adm_coverHelp") },
                {
                    key: "type",
                    label: t("adm_field4Label"),
                    type: "select",
                    defaultValue: kinds[0]?.key ?? "feature",
                    // The colour follows the kind, so there is no second field
                    // to keep in step with it - and no default that made every
                    // release on the page the same shade of blue.
                    options: kinds.map((kind) => ({ value: kind.key, label: changelogKindLabel(t, kind.key, kinds) })),
                },
            ]}
        />
    );
}
