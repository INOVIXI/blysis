"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Badge,
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CheckboxField,
    Input,
    Label,
    LoadFailed,
} from "@/core/sdk/ui";
import { AdminPageHeader } from "@/core/sdk/admin";
import { writeError } from "@/core/sdk";

/**
 * Connecting the site to a game server's LiteBans database.
 *
 * One screen, because there is one decision: an address, the prefix its tables
 * carry, and whether to read them. Splitting the switch from the address would
 * let an operator turn on a connection that has never been tried, which is the
 * state this screen exists to make impossible - the switch is refused until
 * something is stored, and the trial run is next to it.
 *
 * The address is written and never read back. It is a database user on
 * somebody's game server, and a field that returns it puts it in the first
 * screenshot attached to a support thread. A blank field on save keeps the one
 * already stored, which is what makes the field write-only without making
 * every other change on this screen retype it.
 */

interface Cursor {
    kind: string;
    lastId: number;
    syncedAt: string;
}

interface Status {
    configured: boolean;
    prefix: string;
    enabled: boolean;
    scopeKey: string;
    cursors: Cursor[];
}

interface TableProbe {
    kind: string;
    ok: boolean;
}

export default function LiteBansSettingsPage() {
    const t = useTranslations("minecraftLitebans");
    const commonT = useTranslations("common");

    const [status, setStatus] = useState<Status | null>(null);
    const [connection, setConnection] = useState("");
    const [prefix, setPrefix] = useState("litebans_");
    const [scopeKey, setScopeKey] = useState("");
    const [enabled, setEnabled] = useState(false);
    const [probe, setProbe] = useState<TableProbe[] | null>(null);
    const [busy, setBusy] = useState<"save" | "test" | "sync" | "resync" | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
            const res = await fetch("/api/v1/minecraft-litebans/admin/connection");
            if (!res.ok) throw new Error("read");
            const body: Status = await res.json();
            setStatus(body);
            setPrefix(body.prefix);
            setScopeKey(body.scopeKey ?? "");
            setEnabled(body.enabled);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const save = async () => {
        setBusy("save");
        try {
            const res = await fetch("/api/v1/minecraft-litebans/admin/connection", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ connection: connection.trim(), prefix, enabled, scopeKey }),
            });
            const wrong = await writeError(res, t("adm_saveFailed"), t);
            if (wrong) { toast.error(wrong); return; }
            toast.success(t("adm_saved"));
            setConnection("");
            await load();
        } catch {
            toast.error(t("adm_saveFailed"));
        } finally {
            setBusy(null);
        }
    };

    const act = async (action: "test" | "sync" | "resync") => {
        setBusy(action);
        setProbe(null);
        try {
            const res = await fetch("/api/v1/minecraft-litebans/admin/connection", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const wrong = await writeError(res, t("adm_testFailed"), t);
            if (wrong) { toast.error(wrong); return; }
            const body = await res.json();

            if (action === "test") {
                setProbe(body.tables ?? []);
                toast.success(t("adm_testReached"));
                return;
            }
            toast.success(t("adm_syncDone", {
                read: body.summary?.read ?? 0,
                recorded: body.summary?.recorded ?? 0,
            }));
            await load();
        } catch {
            toast.error(t("adm_testFailed"));
        } finally {
            setBusy(null);
        }
    };

    if (loading) {
        return <Card><CardContent className="py-10 text-center text-muted-foreground">{commonT("loading")}</CardContent></Card>;
    }
    if (failed) {
        return (
            <>
                <AdminPageHeader title={t("adm_title")} description={t("adm_subtitle")} />
                <Card><CardContent><LoadFailed onRetry={load} /></CardContent></Card>
            </>
        );
    }

    return (
        <>
            <AdminPageHeader title={t("adm_title")} description={t("adm_subtitle")} />

            <Card className="mb-6">
                <CardHeader>
                    <CardTitle>{t("adm_connection")}</CardTitle>
                    <p className="text-sm text-muted-foreground">{t("adm_connectionDesc")}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label htmlFor="connection">{t("adm_address")}</Label>
                        <Input
                            id="connection"
                            type="password"
                            autoComplete="off"
                            value={connection}
                            placeholder="mysql://readonly:...@host:3306/litebans"
                            onChange={(event) => setConnection(event.target.value)}
                        />
                        <p className="text-xs text-muted-foreground mt-1">{t("adm_addressDialects")}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                            {status?.configured ? t("adm_addressStored") : t("adm_addressNone")}
                        </p>
                    </div>

                    <div>
                        <Label htmlFor="prefix">{t("adm_prefix")}</Label>
                        <Input
                            id="prefix"
                            value={prefix}
                            placeholder="litebans_"
                            onChange={(event) => setPrefix(event.target.value)}
                        />
                        <p className="text-xs text-muted-foreground mt-1">{t("adm_prefixHint")}</p>
                    </div>

                    <div>
                        <Label htmlFor="scopeKey">{t("adm_scope")}</Label>
                        <Input
                            id="scopeKey"
                            value={scopeKey}
                            placeholder="survival"
                            onChange={(event) => setScopeKey(event.target.value)}
                        />
                        <p className="text-xs text-muted-foreground mt-1">{t("adm_scopeHint")}</p>
                    </div>

                    <CheckboxField
                        label={t("adm_enabled")}
                        description={t("adm_enabledHint")}
                        checked={enabled}
                        disabled={!status?.configured && connection.trim() === ""}
                        onChange={(event) => setEnabled(event.target.checked)}
                    />

                    <div className="flex flex-wrap justify-end gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null || !status?.configured}
                            onClick={() => act("test")}
                        >
                            {busy === "test" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                            {t("adm_test")}
                        </Button>
                        <Button size="sm" disabled={busy !== null} onClick={save}>
                            {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                            {t("adm_save")}
                        </Button>
                    </div>

                    {probe ? (
                        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                            {probe.map((table) => (
                                <Badge key={table.kind} tone={table.ok ? "success" : "warning"}>
                                    {t(`kind_${table.kind}`)}
                                    {": "}
                                    {table.ok ? t("adm_tableFound") : t("adm_tableMissing")}
                                </Badge>
                            ))}
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t("adm_reading")}</CardTitle>
                    <p className="text-sm text-muted-foreground">{t("adm_readingDesc")}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                    {status && status.cursors.length > 0 ? (
                        <div className="divide-y">
                            {status.cursors.map((cursor) => (
                                <div key={cursor.kind} className="flex items-center justify-between gap-3 py-2">
                                    <span className="text-sm">{t(`kind_${cursor.kind}`)}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {t("adm_upTo", { id: cursor.lastId })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">{t("adm_neverRead")}</p>
                    )}

                    <div className="flex flex-wrap justify-end gap-2">
                        {/* A full re-read is how a lift older than the window
                            this reads behind its cursor gets noticed. Safe to
                            press twice: every write is an upsert. */}
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null || !status?.enabled}
                            onClick={() => act("resync")}
                        >
                            {busy === "resync" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                            {t("adm_resync")}
                        </Button>
                        <Button size="sm" disabled={busy !== null || !status?.enabled} onClick={() => act("sync")}>
                            {busy === "sync" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                            {t("adm_syncNow")}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </>
    );
}
