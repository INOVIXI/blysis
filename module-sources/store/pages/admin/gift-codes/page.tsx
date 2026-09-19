"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { Button, Card, CardContent, Checkbox, Input, Label, ListControls, Pagination, useConfirm, useFormRoute, useRowPicks, useSiteCurrency, buttonClassName } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import { ArrowLeft, Loader2, Plus, Trash2, Gift, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { copyText, deleteEach } from "@/core/sdk";
import { AdminPageHeader, BulkBar } from "@/core/sdk/admin";

interface GiftCode {
    id: string;
    code: string;
    value: number;
    isRedeemed: boolean;
    redeemedBy: { username: string } | null;
    redeemedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
}

export default function GiftCodesPage() {
    const { format: money } = useSiteCurrency();
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();
    const [codes, setCodes] = useState<GiftCode[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    // The generator is a screen at `?form=new`, not a card above the table.
    const { showForm, formHref, closeForm } = useFormRoute();
    const [value, setValue] = useState("10");
    const [count, setCount] = useState("1");
    const [expiresAt, setExpiresAt] = useState("");
    const [copiedId, setCopiedId] = useState<string | null>(null);
    // Codes are generated in batches, so this table is one of the few here
    // that genuinely reaches thousands of rows. It reads a page at a time.
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    // Sent to the endpoint: thousands of rows means the fifty in the browser
    // are not the list.
    const [search, setSearch] = useState("");
    // The rows come a page at a time from the endpoint, so only the ticking
    // is this screen's: the count on the button is a promise about the page
    // in front of the operator.
    const picks = useRowPicks(codes);

    const fetchCodes = async (targetPage = page) => {
        const query = new URLSearchParams({ page: String(targetPage) });
        if (search.trim()) query.set("q", search.trim());
        const res = await fetch(`/api/v1/gift-codes?${query}`);
        if (res.ok) {
            const data = await res.json();
            setCodes(data.giftCodes || []);
            setTotalPages(Math.max(1, data.pages || 1));
        }
        setLoading(false);
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchCodes(page); }, [page, search]);

    const generate = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const res = await fetch("/api/v1/gift-codes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    value: parseFloat(value),
                    count: parseInt(count),
                    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                toast.success(t("adm_giftCodesGenerated", { count: data.count }));
                setPage(1);
                await fetchCodes(1);
                closeForm();
            } else toast.error(t("adm_giftCodeFailed"));
        } catch {
            toast.error(t("adm_giftCodeFailed"));
        } finally {
            setSaving(false);
        }
    };

    const deleteMany = async () => {
        const ok = await confirm({
            title: t("gc_deleteTitle"),
            message: t("adm_deleteManyConfirm", { count: picks.picked.size }),
            confirmText: t("gc_delete"),
            variant: "danger",
        });
        if (!ok) return;
        const { deleted, total } = await deleteEach([...picks.picked], async (id) => {
            const res = await fetch(`/api/v1/gift-codes/${id}`, { method: "DELETE" });
            return res.ok;
        });
        picks.clear();
        fetchCodes();
        if (deleted === total) toast.success(t("gc_deletedToast"));
        else if (deleted === 0) toast.error(t("gc_deleteError"));
        else toast.error(t("adm_deletedPartly", { deleted, total }));
    };

    const deleteCode = async (id: string) => {
        const ok = await confirm({
            title: t("gc_deleteTitle"),
            message: t("gc_deleteConfirm"),
            confirmText: t("gc_delete"),
            variant: "danger",
        });
        if (!ok) return;
        try {
            const res = await fetch(`/api/v1/gift-codes/${id}`, { method: "DELETE" });
            if (!res.ok) {
                toast.error(t("gc_deleteError"));
                return;
            }
            toast.success(t("gc_deletedToast"));
            fetchCodes();
        } catch {
            toast.error(t("gc_deleteError"));
        }
    };

    const copyCode = async (code: string, id: string) => {
        if (!(await copyText(code))) return;
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

    if (showForm) {
        return (
            <>
                <AdminPageHeader
                    title={t("adm_generateGiftCodes")}
                    description={t("adm_giftCodes")}
                    onBack={closeForm}
                    backLabel={commonT("back")}
                />

                <Card>
                    <CardContent className="p-6">
                        <form onSubmit={generate} className="space-y-4">
                            <div className="grid md:grid-cols-3 gap-4">
                                <div>
                                    <Label>{t("adm_valueDollar")}</Label>
                                    <Input aria-label={t("adm_valueDollar")} type="number" step="0.01" min="0.01" value={value} onChange={(e) => setValue(e.target.value)} required />
                                </div>
                                <div>
                                    <Label>{t("adm_quantity")}</Label>
                                    <Input aria-label={t("adm_quantity")} type="number" min="1" max="100" value={count} onChange={(e) => setCount(e.target.value)} required />
                                </div>
                                <div>
                                    <Label>{t("adm_expiresAt")}</Label>
                                    <Input aria-label={t("adm_expiresAt")} type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button type="submit" disabled={saving}>
                                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
                                    {t("adm_generateCodes", { count: parseInt(count) || 1 })}
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
                title={t("adm_giftCodes")}
                description={t("adm_codesTotal", { total: codes.length, available: codes.filter(c => !c.isRedeemed).length })}
                actions={<>
                    <Link href={formHref()} className={buttonClassName("default", "default")}><Plus className="w-4 h-4" /> {t("adm_generate")}</Link>
                </>}
            />

            <ListControls
                className="mb-4"
                search={{ value: search, onChange: (term) => { setSearch(term); setPage(1); } }}
            />

            <Card>
                <CardContent className="p-0">
                    {codes.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">
                            {search.trim() === "" ? t("adm_noGiftCodesYet") : commonT("noResults")}
                        </p>
                    ) : (
                        <>
                            {/* Outside the scrolling box: a bar that scrolled
                                sideways with the table would take the
                                select-all box off a narrow screen. */}
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
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b">
                                        <th className="w-10 py-3 px-4" />
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("adm_code")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("adm_value")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("adm_status")}</th>
                                        <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("adm_redeemedBy")}</th>
                                        <th className="text-right py-3 px-4 font-medium text-muted-foreground text-sm">{t("adm_actions")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {codes.map((code) => (
                                        <tr key={code.id} className="border-b last:border-0 hover:bg-muted/50">
                                            <td className="py-3 px-4">
                                                <Checkbox
                                                    checked={picks.picked.has(code.id)}
                                                    onChange={() => picks.toggle(code.id)}
                                                    aria-label={t("adm_selectRow")}
                                                />
                                            </td>
                                            <td className="py-3 px-4">
                                                <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">{code.code}</code>
                                            </td>
                                            <td className="py-3 px-4 font-medium">{money(Number(code.value))}</td>
                                            <td className="py-3 px-4">
                                                <span className={`text-xs px-2 py-1 rounded ${code.isRedeemed ? "bg-muted text-muted-foreground" : "bg-success/10 text-success"}`}>
                                                    {code.isRedeemed ? t("adm_redeemed") : t("adm_available")}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-muted-foreground">
                                                {code.redeemedBy?.username || "-"}
                                            </td>
                                            <td className="py-3 px-4 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <Button aria-label={commonT("copy")} variant="ghost" size="sm" onClick={() => copyCode(code.code, code.id)}>
                                                        {copiedId === code.id ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                                                    </Button>
                                                    <Button aria-label={commonT("delete")} variant="ghost" size="sm" className="text-destructive" onClick={() => deleteCode(code.id)}>
                                                        <Trash2 className="w-3 h-3" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        </>
                    )}

                    <Pagination page={page} pages={totalPages} onPageChange={setPage} />
                </CardContent>
            </Card>
        </>
    );
}
