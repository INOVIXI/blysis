"use client";

import { useTranslations } from "next-intl";
import { AdminPageHeader } from "@/core/sdk/admin";
import { ScopeManager } from "../ScopeManager";

/**
 * Where punishments can happen, on a screen of its own.
 *
 * This manager used to sit at the top of the new-punishment form: clicking
 * "New punishment" showed a list of servers, each with a Save and a Delete,
 * and an "Add a place" button, above the box for the player's name. Somebody
 * who came to ban a player was met with a settings editor for a different
 * concept - and the form underneath never asked which place, so the manager
 * governed nothing that screen could produce.
 *
 * It is settings, so it is a settings screen, and the form now has a picker
 * that uses what is declared here.
 */
export default function PunishmentPlacesPage() {
    const t = useTranslations("punishments");
    return (
        <>
            {/* The card below used to carry this heading itself, because it
                was embedded in another screen. It has a screen now, so the
                title is said once. */}
            <AdminPageHeader title={t("adm_scopes")} description={t("adm_scopesHint")} />
            <ScopeManager />
        </>
    );
}
