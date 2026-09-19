"use client";

/**
 * Every key the site has issued, and a form to mint more by hand.
 *
 * Keys minted here come back in the response once and are shown once. There is
 * no "show me that key again" button on purpose: the admin panel stores only a
 * hash and a hint, so the answer would have to be a lie or a second copy of the
 * secret. A customer who lost their key can read it in their own account; an
 * admin who needs to hand one over issues a new one and revokes the old.
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, useConfirm, useFormRoute, useLocalDate, useRowPicks, buttonClassName } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import { ArrowLeft, Loader2, Plus, Trash2, Ban, RotateCcw, Copy, Check, KeyRound } from "lucide-react";
import { copyText, deleteEach } from "@/core/sdk";
import { AdminPageHeader, BulkBar, RowActions } from "@/core/sdk/admin";

interface License {
    id: string;
    keyHint: string;
    productId: string | null;
    productName: string | null;
    orderId: string | null;
    userId: string | null;
    status: string;
    maxActivations: number;
    activations: number;
    expiresAt: string | null;
    note: string | null;
    createdAt: string;
}

export default function LicensesPage() {
    const t = useTranslations("licenseKeys");
    const commonT = useTranslations("common");
    const formatLocalDate = useLocalDate();
    const { confirm } = useConfirm();

    const [licenses, setLicenses] = useState<License[]>([]);
    // The endpoint pages this, so only the ticking is the screen's. Keys are
    // minted in batches, so clearing a batch was a batch of confirmations.
    const picks = useRowPicks(licenses);
    const [loading, setLoading] = useState(true);
    // Issuing keys is a screen at `?form=new`, not a card above the table.
    const { showForm, formHref, closeForm } = useFormRoute();
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState("");
    const [minted, setMinted] = useState<string[]>([]);
    const [copied, setCopied] = useState(false);

    const [productName, setProductName] = useState("");
    const [count, setCount] = useState("1");
    const [maxActivations, setMaxActivations] = useState("1");
    const [validDays, setValidDays] = useState("");
    const [prefix, setPrefix] = useState("");
    const [note, setNote] = useState("");

    const fetchLicenses = useCallback(async (q: string) => {
        const res = await fetch(`/api/v1/licenses/admin${q ? `?q=${encodeURIComponent(q)}` : ""}`);
        if (res.ok) {
            const data = await res.json();
            setLicenses(data.licenses || []);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        // Debounced so typing in the search box does not fire a query per key.
        const timer = setTimeout(() => fetchLicenses(search.trim()), search ? 300 : 0);
        return () => clearTimeout(timer);
    }, [search, fetchLicenses]);

    const issue = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const res = await fetch("/api/v1/licenses/admin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    count: parseInt(count, 10),
                    productName: productName.trim() || undefined,
                    maxActivations: parseInt(maxActivations, 10),
                    validDays: validDays ? parseInt(validDays, 10) : undefined,
                    prefix: prefix.trim() || undefined,
                    note: note.trim() || undefined,
                }),
            });
            if (!res.ok) {
                toast.error(t("adm_issueFailed"));
                return;
            }
            const data = await res.json();
            setMinted(data.keys || []);
            toast.success(t("adm_issued", { count: (data.keys || []).length }));
            await fetchLicenses(search.trim());
            closeForm();
        } finally {
            setSaving(false);
        }
    };

    const setStatus = async (id: string, status: "active" | "revoked") => {
        if (status === "revoked") {
            const ok = await confirm({
                title: t("adm_revokeTitle"),
                message: t("adm_revokeConfirm"),
                confirmText: t("adm_revoke"),
                variant: "danger",
            });
            if (!ok) return;
        }
        const res = await fetch(`/api/v1/licenses/admin/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
        });
        if (!res.ok) {
            toast.error(t("adm_updateFailed"));
            return;
        }
        setLicenses((rows) => rows.map((row) => (row.id === id ? { ...row, status } : row)));
    };

    const deleteMany = async () => {
        const ok = await confirm({
            title: t("adm_deleteTitle"),
            message: t("adm_deleteManyConfirm", { count: picks.picked.size }),
            confirmText: t("adm_delete"),
            variant: "danger",
        });
        if (!ok) return;
        const gone = new Set(picks.picked);
        const { deleted, total } = await deleteEach([...picks.picked], async (id) => {
            const res = await fetch(`/api/v1/licenses/admin/${id}`, { method: "DELETE" });
            if (!res.ok) gone.delete(id);
            return res.ok;
        });
        picks.clear();
        setLicenses((rows) => rows.filter((row) => !gone.has(row.id)));
        if (deleted === 0) toast.error(t("adm_deleteFailed"));
        else if (deleted < total) toast.error(t("adm_deletedPartly", { deleted, total }));
    };

    const remove = async (id: string) => {
        const ok = await confirm({
            title: t("adm_deleteTitle"),
            message: t("adm_deleteConfirm"),
            confirmText: t("adm_delete"),
            variant: "danger",
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/licenses/admin/${id}`, { method: "DELETE" });
        if (!res.ok) {
            toast.error(t("adm_deleteFailed"));
            return;
        }
        setLicenses((rows) => rows.filter((row) => row.id !== id));
    };

    const copyMinted = async () => {
        if (!(await copyText(minted.join("\n")))) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (showForm) {
        return (
            <>
                <AdminPageHeader
                    title={t("adm_issueKeys")}
                    description={t("adm_mintedOnce")}
                    onBack={closeForm}
                    backLabel={commonT("back")}
                />

                <Card>
                    <CardContent className="p-6">
                        <form onSubmit={issue} className="space-y-4">
                            <div className="grid md:grid-cols-3 gap-4">
                                <div>
                                    <Label>{t("adm_productName")}</Label>
                                    <Input aria-label={t("adm_productName")} value={productName} onChange={(e) => setProductName(e.target.value)} />
                                </div>
                                <div>
                                    <Label>{t("adm_quantity")}</Label>
                                    <Input
                                        aria-label={t("adm_quantity")}
                                        type="number"
                                        min="1"
                                        max="500"
                                        value={count}
                                        onChange={(e) => setCount(e.target.value)}
                                        required
                                    />
                                </div>
                                <div>
                                    <Label>{t("adm_maxActivations")}</Label>
                                    <Input
                                        aria-label={t("adm_maxActivations")}
                                        type="number"
                                        min="1"
                                        value={maxActivations}
                                        onChange={(e) => setMaxActivations(e.target.value)}
                                        required
                                    />
                                </div>
                                <div>
                                    <Label>{t("adm_validDays")}</Label>
                                    <Input
                                        aria-label={t("adm_validDays")}
                                        type="number"
                                        min="1"
                                        value={validDays}
                                        onChange={(e) => setValidDays(e.target.value)}
                                        placeholder={t("adm_validDaysPlaceholder")}
                                    />
                                </div>
                                <div>
                                    <Label>{t("adm_prefix")}</Label>
                                    <Input
                                        aria-label={t("adm_prefix")}
                                        value={prefix}
                                        onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                                        maxLength={8}
                                        placeholder="PRO"
                                    />
                                </div>
                                <div>
                                    <Label>{t("adm_note")}</Label>
                                    <Input aria-label={t("adm_note")} value={note} onChange={(e) => setNote(e.target.value)} />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button type="submit" disabled={saving}>
                                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {t("adm_issue")}
                                </Button>
                                <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>
                                    {t("adm_cancel")}
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            </>
        );
    }

    return (
        <>
            <AdminPageHeader
                title={t("adm_title")}
                description={<>
                    {t("adm_summary", {
                        total: licenses.length,
                        active: licenses.filter((l) => l.status === "active").length,
                    })}
                </>}
                actions={<>
                    <Link href={formHref()} className={buttonClassName("default", "default")}><Plus className="w-4 h-4" /> {t("adm_issueKeys")}</Link>
                </>}
            />

            {minted.length > 0 && (
                <Card className="mb-6 border-primary">
                    <CardHeader>
                        <CardTitle>{t("adm_mintedTitle")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <p className="text-sm text-muted-foreground">{t("adm_mintedOnce")}</p>
                        <pre className="rounded bg-muted p-3 font-mono text-sm overflow-x-auto">{minted.join("\n")}</pre>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={copyMinted}>
                                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                {t("adm_copyAll")}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setMinted([])}>
                                {t("adm_dismiss")}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="mb-4">
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("adm_searchPlaceholder")} aria-label={t("adm_searchPlaceholder")}
                    className="max-w-sm"
                />
            </div>

            {licenses.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">{t("adm_empty")}</CardContent>
                </Card>
            ) : (
                <Card>
                    <CardContent className="p-0">
                        {/* Outside the scrolling box, or the select-all box
                            goes sideways with the table. */}
                        <BulkBar
                            state={picks.headerState}
                            count={picks.picked.size}
                            onToggleAll={picks.toggleAll}
                            actions={
                                <Button variant="destructive" size="sm" onClick={deleteMany}>
                                    <Trash2 className="w-4 h-4" /> {commonT("delete")} {picks.picked.size}
                                </Button>
                            }
                        />
                        <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted/40">
                                <tr className="text-left">
                                    <th className="w-10 p-3" />
                                    <th className="p-3 font-medium">{t("adm_colKey")}</th>
                                    <th className="p-3 font-medium">{t("adm_colProduct")}</th>
                                    <th className="p-3 font-medium">{t("adm_colActivations")}</th>
                                    <th className="p-3 font-medium">{t("adm_colStatus")}</th>
                                    <th className="p-3 font-medium">{t("adm_colExpires")}</th>
                                    <th className="p-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {licenses.map((license) => (
                                    <tr key={license.id} className="border-b last:border-0">
                                        <td className="p-3">
                                            <Checkbox
                                                checked={picks.picked.has(license.id)}
                                                onChange={() => picks.toggle(license.id)}
                                                aria-label={t("adm_selectRow")}
                                            />
                                        </td>
                                        <td className="p-3 font-mono">{license.keyHint}</td>
                                        <td className="p-3">{license.productName || "-"}</td>
                                        <td className="p-3">
                                            {license.activations} / {license.maxActivations}
                                        </td>
                                        <td className="p-3">
                                            <span
                                                className={
                                                    license.status === "active"
                                                        ? "text-success"
                                                        : "text-muted-foreground"
                                                }
                                            >
                                                {t(license.status === "active" ? "adm_active" : "adm_revoked")}
                                            </span>
                                        </td>
                                        <td className="p-3">
                                            {license.expiresAt
                                                ? formatLocalDate(license.expiresAt)
                                                : t("adm_never")}
                                        </td>
                                        <td className="p-3 text-right whitespace-nowrap">
                                            <RowActions
                                                actions={[
                                                    {
                                                        icon: Ban,
                                                        label: t("adm_revoke"),
                                                        onClick: () => setStatus(license.id, "revoked"),
                                                        hidden: license.status !== "active",
                                                    },
                                                    {
                                                        icon: RotateCcw,
                                                        label: t("adm_restore"),
                                                        onClick: () => setStatus(license.id, "active"),
                                                        hidden: license.status === "active",
                                                    },
                                                    {
                                                        icon: Trash2,
                                                        label: t("adm_delete"),
                                                        onClick: () => remove(license.id),
                                                        destructive: true,
                                                    },
                                                ]}
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </>
    );
}
