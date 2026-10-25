"use client";

import { useEffect, useState, type ReactNode } from "react";
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

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-6";

/** A card with the most a card shows, to draw the row's outline while waiting. */
const OUTLINE: ServerCard = {
    id: "outline", name: "x", queryable: true, online: true, players: { online: 0, max: 1 },
    address: "x", description: "x ".repeat(120), image: null,
};

/**
 * The room the cards hold until the statuses arrive: a row with one card
 * drawn hidden under whatever is shown instead. A theme sizes a card as it
 * likes, so no fixed number is its height; an outline of the real thing is
 * right under every theme and at every width.
 */
function Room({ capacity, children }: { capacity: boolean; children: ReactNode }) {
    return (
        <div className="relative">
            <div aria-hidden="true" className="invisible">
                <div className={GRID}><Card server={OUTLINE} capacity={capacity} onCopy={() => {}} /></div>
            </div>
            <div className="absolute inset-0 flex flex-col">{children}</div>
        </div>
    );
}

/** How much of a server's room is taken, to a tenth of a percent and never past full. */
function filled(players: { online: number; max: number }): number {
    return Math.round(Math.min(1, players.online / players.max) * 1000) / 10;
}

function Card({ server, capacity, onCopy }: { server: ServerCard; capacity: boolean; onCopy: (address: string) => void }) {
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
                {capacity && server.queryable && server.online && server.players.max > 0 ? (
                    <div data-server-capacity className="flex flex-col gap-1.5 text-sm font-semibold text-muted-foreground">
                        <span>{t("cards_capacity", { online: server.players.online, max: server.players.max })}</span>
                        <span aria-hidden="true" className="block h-2 overflow-hidden rounded-full bg-muted">
                            <span data-server-fill className="block h-full rounded-full bg-success" style={{ width: `${filled(server.players)}%` }} />
                        </span>
                    </div>
                ) : null}
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
 * the status widget always has. With `capacity` each open server also says
 * how much of its room is taken, for a theme whose cards have space for it.
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
    const capacity = settings.capacity === true;

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
        <div>
            <BlockHeading kicker={text(settings.kicker) || undefined} title={text(settings.title) || t("widget_title")} />
            {failed ? (
                <LoadFailed onRetry={() => { setFailed(false); setReloadKey((k) => k + 1); }} />
            ) : servers === null ? (
                <Room capacity={capacity}><Waiting label={commonT("loading")} /></Room>
            ) : (
                <div className={GRID}>
                    {servers.map((server) => <Card key={server.id} server={server} capacity={capacity} onCopy={copy} />)}
                </div>
            )}
        </div>
    );
}
