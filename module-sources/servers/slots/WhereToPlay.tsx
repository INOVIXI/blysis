"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { sharedJson } from "@/core/sdk";
import type { CountedServer } from "../lib/players-online";

interface ListedServer extends CountedServer {
    id: string;
    name: string;
}

/**
 * Beside the sign-up form, in a theme's `auth.register.aside`: every server
 * by name and how many are on it, so someone making an account knows where
 * they will play. A server this module cannot ask is named with no count
 * rather than called closed.
 *
 * Nothing is drawn while the answer is not in or could not be read, or on a
 * site with no server: it sits beside a form, not in place of one.
 */
export default function WhereToPlay() {
    const t = useTranslations("servers");
    const [servers, setServers] = useState<ListedServer[] | null>(null);

    useEffect(() => {
        let active = true;
        sharedJson<{ servers?: ListedServer[] }>("/api/v1/servers/status")
            .then((d) => { if (active) setServers(Array.isArray(d?.servers) ? d.servers : []); })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    if (servers === null || servers.length === 0) return null;
    return (
        <section data-where-to-play className="rounded-xl bg-card p-5 text-card-foreground">
            <h2 className="mb-3 font-bold">{t("slot_whereToPlay")}</h2>
            <ul className="flex flex-col gap-2">
                {servers.map((s) => (
                    <li key={s.id} data-server-row className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2.5 text-sm font-semibold">
                        <span className="truncate">{s.name}</span>
                        {s.queryable ? (
                            <span data-state={s.online ? "open" : "closed"} className="shrink-0 text-xs text-muted-foreground">
                                {s.online ? t("cards_players", { count: s.players.online }) : t("tag_closed")}
                            </span>
                        ) : null}
                    </li>
                ))}
            </ul>
        </section>
    );
}
