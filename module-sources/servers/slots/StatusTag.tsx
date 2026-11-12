"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { sharedJson } from "@/core/sdk";
import { anyOnline, playersOnline, type CountedServer } from "../lib/players-online";

/**
 * A tag for the hero's `hero.tags`: whether the server is open, and how many
 * are on it. A theme draws it beside its own label, so it brings no colour of
 * its own beyond `data-state`.
 *
 * It says nothing about a game this module cannot ask, rather than calling it
 * closed, and nothing while the answer is not in or could not be read.
 */
export default function StatusTag() {
    const t = useTranslations("servers");
    // Every reader of this answer asks in the page's language, so they share one request.
    const locale = useLocale();
    const [servers, setServers] = useState<CountedServer[] | null>(null);

    useEffect(() => {
        let active = true;
        sharedJson<{ servers?: CountedServer[] }>(`/api/v1/servers/status?locale=${encodeURIComponent(locale)}`)
            .then((d) => { if (active) setServers(Array.isArray(d?.servers) ? d.servers : []); })
            .catch(() => {});
        return () => { active = false; };
    }, [locale]);

    const count = servers ? playersOnline(servers) : null;
    if (servers === null || count === null) return null;
    const open = anyOnline(servers);
    return (
        <span data-hero-tag data-state={open ? "open" : "closed"}>
            {open ? t("tag_open", { count }) : t("tag_closed")}
        </span>
    );
}
