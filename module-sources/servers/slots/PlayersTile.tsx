"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { sharedJson } from "@/core/sdk";
import { StatTile } from "@/core/sdk/ui";

interface ServerStatus {
    queryable: boolean;
    online: boolean;
    players: { online: number };
}

/**
 * Everyone playing right now, as a tile in the homepage's stats row.
 *
 * Only a server that answers is counted: a game this module cannot ask has
 * no count to add, and a server that is down has nobody on it whatever its
 * last answer said. With no server that can be asked there is no number to
 * show, so the tile is not drawn and the row keeps the operator's own.
 */
export default function PlayersTile() {
    const t = useTranslations("servers");
    const format = useFormatter();
    const [count, setCount] = useState<number | null>(null);

    useEffect(() => {
        let active = true;
        sharedJson<{ servers?: ServerStatus[] }>("/api/v1/servers/status")
            .then((d) => {
                const asked = (Array.isArray(d?.servers) ? d.servers : []).filter((s) => s.queryable);
                if (active && asked.length > 0) {
                    setCount(asked.reduce((sum, s) => sum + (s.online ? s.players.online : 0), 0));
                }
            })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    if (count === null) return null;
    return <StatTile value={format.number(count)} label={t("tile_players")} icon="Users" />;
}
