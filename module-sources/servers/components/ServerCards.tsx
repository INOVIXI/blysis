"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Server } from "lucide-react";
import { copyText, sharedJson } from "@/core/sdk";
import { BlockHeading, Button, LoadFailed, Waiting, useBlockText, type BlockProps } from "@/core/sdk/ui";

interface ServerCard {
    id: string;
    name: string;
    queryable: boolean;
    online: boolean;
    players: { online: number; max: number };
    /** Null when the server's address is an inside one, which is never shown. */
    address: string | null;
    description: string | null;
    image: string | null;
}

/**
 * Room the cards hold until the statuses arrive: a heading over one row of
 * cards, whose picture is a ratio and whose text is a fixed number of lines.
 */
const ROOM = "min-h-[25rem]";

function Card({ server, onCopy }: { server: ServerCard; onCopy: (address: string) => void }) {
    const t = useTranslations("servers");
    return (
        <article data-server-card className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
            <div className="relative aspect-card overflow-hidden bg-muted">
                {server.image ? (
                    <Image src={server.image} alt="" fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
                ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-primary/20 to-muted">
                        <Server className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                    </div>
                )}
                {server.queryable ? (
                    <span data-server-players className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-card/90 px-2 py-1 text-xs font-bold ${server.online ? "text-success" : "text-muted-foreground"}`}>
                        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${server.online ? "bg-success" : "bg-muted-foreground"}`} />
                        {server.online ? t("cards_players", { count: server.players.online }) : t("offline")}
                    </span>
                ) : null}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-5">
                <h3 className="truncate text-lg font-bold text-foreground">{server.name}</h3>
                {server.description ? <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{server.description}</p> : null}
                {server.address ? (
                    <Button
                        type="button"
                        variant="secondary"
                        className="mt-auto self-start"
                        aria-label={t("widget_copy", { name: server.name })}
                        onClick={() => onCopy(server.address as string)}
                    >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                        <span className="font-mono">{server.address}</span>
                    </Button>
                ) : null}
            </div>
        </article>
    );
}

/**
 * `servers.cards`: a card for every active server, for a homepage that
 * offers its game modes. Each says how many play, what the server is, and
 * copies the address a player types; the copy goes through `copyText`, which
 * works over the plain http a fresh install is served on.
 *
 * A site with no server draws nothing rather than an empty section, the way
 * the status widget always has.
 */
export function ServerCards({ settings }: BlockProps) {
    const t = useTranslations("servers");
    const commonT = useTranslations("common");
    const text = useBlockText();
    const [servers, setServers] = useState<ServerCard[] | null>(null);
    // A read that did not come back says so rather than reading as a site
    // with no server (an-empty-screen-says-which-empty).
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let active = true;
        sharedJson<{ servers?: ServerCard[] }>("/api/v1/servers/status")
            .then((d) => { if (active) setServers(Array.isArray(d?.servers) ? d.servers : []); })
            .catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [reloadKey]);

    if (!failed && servers !== null && servers.length === 0) return null;

    const copy = async (address: string) => {
        if (await copyText(address)) toast.success(t("widget_copied"));
        else toast.error(t("widget_copyFailed"));
    };

    return (
        <div className={servers === null ? `${ROOM} flex flex-col` : undefined}>
            <BlockHeading kicker={text(settings.kicker) || undefined} title={text(settings.title) || t("widget_title")} />
            {failed ? (
                <LoadFailed onRetry={() => { setFailed(false); setReloadKey((k) => k + 1); }} />
            ) : servers === null ? (
                <Waiting label={commonT("loading")} />
            ) : (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-6">
                    {servers.map((server) => <Card key={server.id} server={server} onCopy={copy} />)}
                </div>
            )}
        </div>
    );
}
