"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Server } from "lucide-react";
import { copyText } from "@/core/sdk";
import { Button } from "@/core/sdk/ui";

interface ServerRow {
    id: string;
    name: string;
    queryable: boolean;
    online: boolean;
    players: { online: number; max: number };
    /** Null when the server's address is an inside one, which is never shown. */
    address: string | null;
}

/**
 * Where the game is played, for the homepage: each active server, how many
 * are on it and a button that copies the address a player types.
 *
 * The statuses are the public endpoint's, which caches each server's answer,
 * so a busy homepage does not turn into a stream of queries at a game server.
 * A game this module cannot ask gets its address and no count, rather than a
 * permanent "offline" it never earned, and a server registered by an inside
 * address gets its count and no address.
 */
export function ServerStatusWidget() {
    const t = useTranslations("servers");
    const [servers, setServers] = useState<ServerRow[]>([]);

    useEffect(() => {
        let active = true;
        fetch("/api/v1/servers/status")
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { servers?: ServerRow[] } | null) => {
                if (active && Array.isArray(d?.servers)) setServers(d.servers);
            })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    if (servers.length === 0) return null;

    const copy = async (address: string) => {
        if (await copyText(address)) toast.success(t("widget_copied"));
        else toast.error(t("widget_copyFailed"));
    };

    return (
        <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
                <Server className="w-4 h-4 text-primary" />
                <h2 className="font-bold text-foreground">{t("widget_title")}</h2>
            </div>
            <ul className="space-y-3">
                {servers.map(({ address, ...server }) => (
                    <li key={server.id} className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                            <p className="font-semibold text-foreground truncate">{server.name}</p>
                            {server.queryable ? (
                                <p className="text-xs flex items-center gap-1.5">
                                    <span aria-hidden="true" className={`w-2 h-2 rounded-full ${server.online ? "bg-success" : "bg-muted-foreground"}`} />
                                    <span className={server.online ? "text-success" : "text-muted-foreground"}>
                                        {server.online
                                            ? t("widget_playing", { online: server.players.online, max: server.players.max })
                                            : t("offline")}
                                    </span>
                                </p>
                            ) : null}
                            {address ? (
                                <p className="text-xs text-muted-foreground font-mono truncate">{address}</p>
                            ) : null}
                        </div>
                        {address ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                aria-label={t("widget_copy", { name: server.name })}
                                onClick={() => copy(address)}
                            >
                                <Copy className="w-4 h-4" />
                            </Button>
                        ) : null}
                    </li>
                ))}
            </ul>
        </div>
    );
}
