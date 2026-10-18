"use client";

/**
 * The game servers and how each one is connected: its token, whether it is
 * online, what it may do, and how many deliveries wait for it. A token is
 * shown once, the moment it is made, and never again.
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardContent, Checkbox, CheckboxField, useConfirm, useRelativeTime, useRowPicks } from "@/core/sdk/ui";
import { copyText, deleteEach } from "@/core/sdk";
import { AdminPageHeader, BulkBar, RowActions } from "@/core/sdk/admin";

interface Connection {
    tokenHint: string;
    enabled: boolean;
    allowCreditAdmin: boolean;
    allowVoucherGive: boolean;
    acceptFollowPlayer: boolean;
    instanceSeenAt: string | null;
    role: string;
    clientVersion: string | null;
    softwareName: string | null;
    softwareVersion: string | null;
    online: number | null;
    maxPlayers: number | null;
}

interface Row {
    id: string;
    name: string;
    host: string;
    connection: Connection | null;
    jobs: Record<string, number>;
}

type Power = "enabled" | "allowCreditAdmin" | "allowVoucherGive" | "acceptFollowPlayer";
const POWERS: Power[] = ["enabled", "allowCreditAdmin", "allowVoucherGive", "acceptFollowPlayer"];

/** A connection counts as live while its process was heard from in the last two minutes. */
const LIVE_MS = 120_000;

export default function ServersPage() {
    const t = useTranslations("gameConnect");
    const { confirm } = useConfirm();
    const ago = useRelativeTime();
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [issued, setIssued] = useState<{ server: string; token: string } | null>(null);
    const [copied, setCopied] = useState(false);
    // Only a connected server has a token to revoke, so only those can be picked.
    const connected = rows.filter((row) => row.connection !== null);
    const picks = useRowPicks(connected);

    const load = useCallback(async () => {
        const res = await fetch("/api/v1/game-connect/admin/servers");
        if (res.ok) setRows((await res.json()).servers ?? []);
        else toast.error(t("srv_loadFailed"));
        setLoading(false);
    }, [t]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, [load]);

    const issue = async (row: Row) => {
        if (row.connection) {
            const ok = await confirm({ title: t("srv_newTokenTitle"), message: t("srv_newTokenConfirm", { server: row.name }), confirmText: t("srv_newToken"), variant: "danger" });
            if (!ok) return;
        }
        const res = await fetch("/api/v1/game-connect/admin/servers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gameServerId: row.id }),
        });
        if (!res.ok) return void toast.error(t("srv_tokenFailed"));
        setIssued({ server: row.name, token: (await res.json()).token });
        setCopied(false);
        load();
    };

    const revoke = async (row: Row) => {
        const ok = await confirm({ title: t("srv_revokeTitle"), message: t("srv_revokeConfirm", { server: row.name }), confirmText: t("srv_revoke"), variant: "danger" });
        if (!ok) return;
        const res = await fetch(`/api/v1/game-connect/admin/servers/${row.id}`, { method: "DELETE" });
        if (res.ok) toast.success(t("srv_revoked"));
        else toast.error(t("srv_saveFailed"));
        load();
    };

    const revokeMany = async () => {
        const ok = await confirm({ title: t("srv_revokeTitle"), message: t("srv_revokeManyConfirm", { count: picks.picked.size }), confirmText: t("srv_revoke"), variant: "danger" });
        if (!ok) return;
        const { deleted, total } = await deleteEach([...picks.picked], async (id) => {
            const res = await fetch(`/api/v1/game-connect/admin/servers/${id}`, { method: "DELETE" });
            return res.ok;
        });
        picks.clear();
        if (deleted === total) toast.success(t("srv_revoked"));
        else toast.error(t("srv_revokedPartly", { deleted, total }));
        load();
    };

    const toggle = async (row: Row, power: Power, value: boolean) => {
        const res = await fetch(`/api/v1/game-connect/admin/servers/${row.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [power]: value }),
        });
        if (!res.ok) toast.error(t("srv_saveFailed"));
        load();
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

    return (
        <>
            <AdminPageHeader title={t("srv_title")} description={t("srv_subtitle")} />

            {issued && (
                <Card className="mb-4 border-warning">
                    <CardContent className="p-4 space-y-2">
                        <p className="font-medium">{t("srv_tokenFor", { server: issued.server })}</p>
                        <p className="text-sm text-muted-foreground">{t("srv_tokenOnce")}</p>
                        <div className="flex items-center gap-2">
                            <code className="font-mono text-sm bg-muted px-2 py-1 rounded break-all">{issued.token}</code>
                            <Button size="sm" variant="outline" onClick={async () => setCopied(await copyText(issued.token))}>
                                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {t("srv_copy")}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {rows.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">{t("srv_none")}</p>
            ) : (
                <div className="space-y-3">
                    {connected.length > 0 && (
                        <BulkBar
                            state={picks.headerState}
                            count={picks.picked.size}
                            onToggleAll={picks.toggleAll}
                            actions={
                                <Button variant="destructive" size="sm" onClick={revokeMany}>
                                    <Trash2 className="w-4 h-4" /> {t("srv_revoke")} {picks.picked.size}
                                </Button>
                            }
                        />
                    )}
                    {rows.map((row) => {
                        const connection = row.connection;
                        const seen = connection?.instanceSeenAt ? new Date(connection.instanceSeenAt) : null;
                        const live = seen !== null && Date.now() - seen.getTime() < LIVE_MS;
                        const waiting = (row.jobs.PENDING ?? 0) + (row.jobs.CLAIMED ?? 0);
                        const review = row.jobs.NEEDS_REVIEW ?? 0;
                        return (
                            <Card key={row.id}>
                                <CardContent className="p-4 space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-start gap-3">
                                            {connection && (
                                                <Checkbox checked={picks.picked.has(row.id)} onChange={() => picks.toggle(row.id)} aria-label={t("srv_pick")} />
                                            )}
                                            <div>
                                            <p className="font-medium">{row.name} <span className="text-sm text-muted-foreground">{row.host}</span></p>
                                            <p className="text-sm text-muted-foreground">
                                                {!connection
                                                    ? t("srv_notConnected")
                                                    : live
                                                      ? t("srv_live", { online: connection.online ?? 0, max: connection.maxPlayers ?? 0, software: `${connection.softwareName ?? ""} ${connection.softwareVersion ?? ""}`.trim() })
                                                      : seen
                                                        ? t("srv_lastSeen", { when: ago(seen) })
                                                        : t("srv_neverSeen", { hint: connection.tokenHint })}
                                            </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {connection && <Badge tone={live ? "success" : "neutral"}>{live ? t("srv_online") : t("srv_offline")}</Badge>}
                                            {connection?.role === "network-root" && <Badge tone="neutral">{t("srv_networkRoot")}</Badge>}
                                            {waiting > 0 && <Badge tone="neutral">{t("srv_waiting", { count: waiting })}</Badge>}
                                            {review > 0 && <Badge tone="danger">{t("srv_review", { count: review })}</Badge>}
                                            <RowActions
                                                actions={[
                                                    { icon: KeyRound, label: connection ? t("srv_newToken") : t("srv_makeToken"), onClick: () => issue(row) },
                                                    ...(connection ? [{ icon: Trash2, label: t("srv_revoke"), onClick: () => revoke(row), destructive: true }] : []),
                                                ]}
                                            />
                                        </div>
                                    </div>
                                    {connection && (
                                        <div className="grid sm:grid-cols-2 gap-2">
                                            {POWERS.map((power) => (
                                                <CheckboxField
                                                    key={power}
                                                    label={t(`srv_power_${power}`)}
                                                    description={t(`srv_power_${power}_hint`)}
                                                    checked={connection[power]}
                                                    onChange={(event) => toggle(row, power, event.target.checked)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </>
    );
}
