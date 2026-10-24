"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { sharedJson } from "@/core/sdk";
import { StatTile } from "@/core/sdk/ui";
import { playersOnline, type CountedServer } from "../lib/players-online";

/**
 * Everyone playing right now, as a tile in the homepage's stats row.
 *
 * Counted by `playersOnline`. With no server that can be asked there is no
 * number to show, so the tile is not drawn and the row keeps the operator's
 * own.
 */
export default function PlayersTile() {
    const t = useTranslations("servers");
    const format = useFormatter();
    const [count, setCount] = useState<number | null>(null);

    useEffect(() => {
        let active = true;
        sharedJson<{ servers?: CountedServer[] }>("/api/v1/servers/status")
            .then((d) => { if (active) setCount(playersOnline(Array.isArray(d?.servers) ? d.servers : [])); })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    if (count === null) return null;
    return <StatTile value={format.number(count)} label={t("tile_players")} icon="Users" />;
}
