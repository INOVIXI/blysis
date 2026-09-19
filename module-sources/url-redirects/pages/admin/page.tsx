"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AdminPageHeader, BulkBar } from "@/core/sdk/admin";
import { Button, Card, CardContent, Checkbox, CheckboxField, Input, Label, ListControls, LoadFailed, Pagination, useConfirm, useRowList } from "@/core/sdk/ui";
import { deleteEach, errorMessage } from "@/core/sdk";
import { Loader2, Plus, Trash2 } from "lucide-react";

interface Redirect {
    id: string;
    from: string;
    to: string;
    permanent: boolean;
}

export default function UrlRedirectsPage() {
    const t = useTranslations("urlRedirects");
    const commonT = useTranslations("common");
    const [redirects, setRedirects] = useState<Redirect[]>([]);
    // The two lines the table draws. A list like this grows without
    // bound and paging to a row was the only way to reach one.
    const list = useRowList(redirects, { text: (r) => [r.from, r.to], pageSize: 20 });
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const { confirm } = useConfirm();
    const [saving, setSaving] = useState(false);
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [permanent, setPermanent] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch("/api/v1/url-redirects")
            .then((res) => { if (!res.ok) throw new Error("load"); return res.json(); })
            .then((data) => { if (!cancelled) { setRedirects(data.redirects ?? []); setFailed(false); } })
            .catch(() => { if (!cancelled) setFailed(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [reloadKey]);

    const add = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        try {
            const res = await fetch("/api/v1/url-redirects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ from, to, permanent }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) { toast.error(errorMessage(data, t("adm_addFailed"), t)); return; }
            setFrom(""); setTo("");
            setReloadKey((k) => k + 1);
            toast.success(t("adm_added"));
        } catch {
            toast.error(commonT("somethingWentWrong"));
        } finally {
            setSaving(false);
        }
    };

    const removeMany = async () => {
        const ok = await confirm({
            title: t("adm_removeTitle"),
            message: t("adm_removeConfirm"),
            variant: "danger",
            confirmText: commonT("delete"),
        });
        if (!ok) return;
        // Every answer read: a list where four of five were refused must not
        // report itself as done and leave four signs still up.
        const { deleted, total } = await deleteEach([...list.picked], async (id) => {
            const res = await fetch(`/api/v1/url-redirects/${id}`, { method: "DELETE" });
            return res.ok;
        });
        list.clear();
        setReloadKey((k) => k + 1);
        if (deleted === total) toast.success(t("adm_removed"));
        else if (deleted === 0) toast.error(t("adm_removeFailed"));
        else toast.error(t("adm_removedPartly", { deleted, total }));
    };

    return (
        <>
            <AdminPageHeader title={t("adm_title")} description={t("adm_subtitle")} />

            <Card className="mb-6">
                <CardContent className="p-6">
                    <form onSubmit={add} className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div>
                                <Label htmlFor="redirectFrom">{t("adm_from")}</Label>
                                <Input
                                    id="redirectFrom"
                                    value={from}
                                    onChange={(e) => setFrom(e.target.value)}
                                    placeholder="/old-pricing"
                                    required
                                />
                                <p className="mt-1 text-xs text-muted-foreground">{t("adm_fromHint")}</p>
                            </div>
                            <div>
                                <Label htmlFor="redirectTo">{t("adm_to")}</Label>
                                <Input
                                    id="redirectTo"
                                    value={to}
                                    onChange={(e) => setTo(e.target.value)}
                                    placeholder="/pricing"
                                    required
                                />
                                <p className="mt-1 text-xs text-muted-foreground">{t("adm_toHint")}</p>
                            </div>
                        </div>
                        <CheckboxField
                            id="redirectPermanent"
                            label={t("adm_permanent")}
                            description={t("adm_permanentHint")}
                            checked={permanent}
                            onChange={(e) => setPermanent(e.target.checked)}
                        />
                        <Button type="submit" disabled={saving}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                            {t("adm_add")}
                        </Button>
                    </form>
                </CardContent>
            </Card>

            <ListControls
                className="mb-4"
                search={{ value: list.search, onChange: list.setSearch }}
            />

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : failed ? (
                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
            ) : redirects.length === 0 ? (
                <Card><CardContent className="py-10 text-center"><p className="text-muted-foreground">{t("adm_none")}</p></CardContent></Card>
            ) : list.rows.length === 0 ? (
                <Card><CardContent className="py-10 text-center"><p className="text-muted-foreground">{commonT("noResults")}</p></CardContent></Card>
            ) : (
                <div className="space-y-2">
                    <BulkBar
                        className="rounded-lg border border-border"
                        state={list.headerState}
                        count={list.picked.size}
                        onToggleAll={list.toggleAll}
                        actions={
                            <Button variant="destructive" size="sm" onClick={removeMany}>
                                <Trash2 className="w-4 h-4" /> {commonT("delete")} {list.picked.size}
                            </Button>
                        }
                    />
                    {list.rows.map((redirect) => (
                        <Card key={redirect.id}>
                            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                                <Checkbox
                                    checked={list.picked.has(redirect.id)}
                                    onChange={() => list.toggle(redirect.id)}
                                    aria-label={t("adm_selectRow")}
                                />
                                <div className="min-w-0 font-mono text-sm">
                                    <span className="text-muted-foreground">{redirect.from}</span>
                                    <span className="mx-2 text-muted-foreground">-&gt;</span>
                                    <span>{redirect.to}</span>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                    <span>{redirect.permanent ? "308" : "307"}</span>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                    <Pagination
                        page={list.page}
                        pages={list.pages}
                        total={list.total}
                        onPageChange={list.setPage}
                    />
                </div>
            )}
        </>
    );
}
