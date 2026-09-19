"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Input,
    Label,
    ListControls,
    LoadFailed,
    useRowList,
} from "@/core/sdk/ui";
import { AdminPageHeader } from "@/core/sdk/admin";
import { writeError } from "@/core/sdk";
import { DEFAULT_CONNECTION_KEY } from "../../lib/connection";
import { EMPTY_SOURCE, SourceEditor, type SourceDraftValue } from "./SourceEditor";

/**
 * The connection, and the lists read through it.
 *
 * One screen rather than two, because they are one decision: a connection with
 * no source reads nothing, and a source with no connection is a list that
 * answers an error. Seeing both together is what tells an operator which half
 * they have not done.
 *
 * The connection string is written and never read back. It is a credential,
 * and a field that returns it puts it in a screenshot the first time somebody
 * asks for help with this screen.
 */

interface StoredSource {
    id: string;
    slug: string;
    title: string;
    settingKey: string;
    table: string;
    columns: string[];
    orderBy: string;
    descending: boolean;
    rowLimit: number;
    cacheSeconds: number;
    isActive: boolean;
}

function toDraft(source: StoredSource): SourceDraftValue {
    return {
        id: source.id,
        slug: source.slug,
        title: source.title,
        settingKey: source.settingKey,
        table: source.table,
        columns: source.columns.join(", "),
        orderBy: source.orderBy,
        descending: source.descending,
        rowLimit: source.rowLimit,
        cacheSeconds: source.cacheSeconds,
        isActive: source.isActive,
    };
}

export default function ExternalDataSettingsPage() {
    const t = useTranslations("externalData");
    const commonT = useTranslations("common");

    const [sources, setSources] = useState<StoredSource[]>([]);
    // The lines the row draws. This list grows and paging to a row was the
    // only way to reach one.
    const list = useRowList(sources, { text: (row) => [row.title, row.slug], pageSize: 20 });
    const [draft, setDraft] = useState<SourceDraftValue | null>(null);
    const [connection, setConnection] = useState("");
    const [savingConnection, setSavingConnection] = useState(false);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
            const res = await fetch("/api/v1/external-data/admin/sources");
            if (!res.ok) throw new Error("read");
            const body = await res.json();
            setSources(body.sources ?? []);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const saveConnection = async () => {
        setSavingConnection(true);
        try {
            const res = await fetch("/api/v1/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [DEFAULT_CONNECTION_KEY]: connection.trim() }),
            });
            const wrong = await writeError(res, t("adm_saveFailed"), t);
            if (wrong) { toast.error(wrong); return; }
            toast.success(t("adm_connectionSaved"));
            setConnection("");
        } catch {
            toast.error(t("adm_saveFailed"));
        } finally {
            setSavingConnection(false);
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
            <AdminPageHeader
                title={t("adm_title")}
                description={t("adm_subtitle")}
                actions={
                    draft ? undefined : (
                        <Button onClick={() => setDraft({ ...EMPTY_SOURCE })}>
                            <Plus className="w-4 h-4" aria-hidden="true" />
                            {t("adm_newSource")}
                        </Button>
                    )
                }
            />

            <Card className="mb-6">
                <CardHeader>
                    <CardTitle>{t("adm_connection")}</CardTitle>
                    <p className="text-sm text-muted-foreground">{t("adm_connectionDesc")}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div>
                        <Label htmlFor="connection">{t("adm_connection")}</Label>
                        <Input
                            id="connection"
                            type="password"
                            value={connection}
                            placeholder="postgres://readonly:...@host:5432/database"
                            onChange={(e) => setConnection(e.target.value)}
                        />
                        {/* Written and never read back: a field that returns a
                            credential puts it in the first screenshot somebody
                            attaches to a support thread. */}
                        <p className="text-xs text-muted-foreground mt-1">{t("adm_connectionDialects")}</p>
                        <p className="text-xs text-muted-foreground mt-1">{t("adm_connectionWriteOnly")}</p>
                    </div>
                    <div className="flex justify-end">
                        <Button
                            size="sm"
                            disabled={savingConnection || connection.trim() === ""}
                            onClick={saveConnection}
                        >
                            {t("adm_connectionSave")}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {draft ? (
                <SourceEditor
                    value={draft}
                    onChange={setDraft}
                    onCancel={() => setDraft(null)}
                    onSaved={() => { setDraft(null); void load(); }}
                />
            ) : (
                <Card>
                    <CardHeader><CardTitle>{t("adm_sources")}</CardTitle></CardHeader>
                    <CardContent className="p-0">
                        <ListControls className="mb-4" search={{ value: list.search, onChange: list.setSearch }} />

                        {sources.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8">{t("adm_noSources")}</p>
                        ) : (
                            <div className="divide-y">
                                {list.rows.map((source) => (
                                    <div key={source.id} className="flex items-center gap-3 p-4">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium">{source.title}</p>
                                            <p className="text-xs text-muted-foreground font-mono break-all">
                                                {source.table} ({source.columns.join(", ")})
                                                {!source.isActive ? ` - ${t("adm_sourceOff")}` : ""}
                                            </p>
                                        </div>
                                        <Button variant="outline" size="sm" onClick={() => setDraft(toDraft(source))}>
                                            {t("adm_editSource")}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </>
    );
}
