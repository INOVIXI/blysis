"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback } from "react";
import { Link } from "@/core/sdk/navigation";
import { Button, Card, CardContent, Checkbox, Input, Label, ListControls, Pagination, RichTextEditor, useConfirm, useFormRoute, useRowList, CheckboxField, buttonClassName } from "@/core/sdk/ui";
import { ArrowLeft, Loader2, Plus, Trash2, ExternalLink, Pencil, LayoutDashboard } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader, BulkBar } from "@/core/sdk/admin";
import { deleteEach } from "@/core/sdk";

interface CustomPage {
    id: string;
    title: string;
    slug: string;
    isActive: boolean;
    order: number;
    createdAt: string;
}

export default function CustomPagesAdminPage() {
    const t = useTranslations("customPages");
    const commonT = useTranslations("common");
    const [pages, setPages] = useState<CustomPage[]>([]);
    // The two lines the table draws. A list like this grows without
    // bound and paging to a row was the only way to reach one.
    const list = useRowList(pages, { text: (row) => [row.title, row.slug], pageSize: 20 });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const { confirm } = useConfirm();

    // The editor is a screen of its own at `?form=new` or `?form=<id>`, so it
    // survives a reload and the back button closes it.
    const { showForm, editingId, formHref, openForm, closeForm } = useFormRoute();

    const [title, setTitle] = useState("");
    const [slug, setSlug] = useState("");
    const [content, setContent] = useState("");
    const [isActive, setIsActive] = useState(true);
    const [order, setOrder] = useState(0);

    const fetchPages = useCallback(async () => {
        const res = await fetch("/api/v1/custom-pages");
        if (res.ok) { const data = await res.json(); setPages(data.pages || []); }
        setLoading(false);
    }, []);

    useEffect(() => { fetchPages(); }, [fetchPages]);

    const resetForm = () => {
        setTitle(""); setSlug(""); setContent(""); setIsActive(true); setOrder(0);
    };

    // The page the URL names is loaded once the list arrives, so opening
    // `?form=<id>` directly - or reloading it - lands on a filled editor. The
    // body is not in the list response, hence the second request.
    useEffect(() => {
        if (!editingId) { resetForm(); return; }
        const row = pages.find((page) => page.id === editingId);
        if (!row) return;
        let cancelled = false;
        fetch(`/api/v1/custom-pages/${row.slug}`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load"))))
            .then((data) => {
                if (cancelled) return;
                setTitle(data.page.title);
                setSlug(data.page.slug);
                setContent(data.page.content || "");
                setIsActive(data.page.isActive);
                setOrder(data.page.order || 0);
            })
            .catch(() => {
                // An editor that silently stays blank looks like an empty
                // page, and saving it would then wipe the real one.
                if (!cancelled) toast.error(t("adm_loadFailed"));
            });
        return () => { cancelled = true; };
    }, [editingId, pages, t]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);

        try {
            if (editingId) {
                const res = await fetch(`/api/v1/custom-pages/${editingId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title, content, isActive, order }),
                });
                if (res.ok) {
                    toast.success(t("adm_pageUpdated"));
                    await fetchPages();
                    closeForm();
                } else {
                    toast.error(t("adm_updateFailed"));
                }
            } else {
                const res = await fetch("/api/v1/custom-pages", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title, slug: slug || undefined, content, isActive, order }),
                });
                if (res.ok) {
                    toast.success(t("adm_pageCreated"));
                    await fetchPages();
                    closeForm();
                } else {
                    toast.error(t("adm_createFailed"));
                }
            }
        } catch {
            toast.error(editingId ? t("adm_updateFailed") : t("adm_createFailed"));
        } finally {
            setSaving(false);
        }
    };

    const deleteMany = async () => {
        const ok = await confirm({
            title: t("adm_deleteTitle"),
            message: t("adm_deleteManyConfirm", { count: list.picked.size }),
            variant: "danger",
            confirmText: t("adm_delete"),
        });
        if (!ok) return;
        // The endpoint takes the address, not the id: every answer is read so
        // a run where some were refused cannot report itself as done.
        const bySlug = new Map(pages.map((row) => [row.id, row.slug]));
        const { deleted, total } = await deleteEach([...list.picked], async (id) => {
            const res = await fetch(`/api/v1/custom-pages/${bySlug.get(id)}`, { method: "DELETE" });
            return res.ok;
        });
        list.clear();
        fetchPages();
        if (deleted === total) toast.success(t("adm_pageDeleted"));
        else if (deleted === 0) toast.error(t("adm_deleteFailed"));
        else toast.error(t("adm_deletedPartly", { deleted, total }));
    };

    const deletePage = async (page: CustomPage) => {
        const ok = await confirm({
            title: t("adm_deleteTitle"),
            message: t("adm_deleteConfirm", { title: page.title }),
            variant: "danger",
            confirmText: t("adm_delete"),
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/custom-pages/${page.slug}`, { method: "DELETE" });
        if (res.ok) {
            toast.success(t("adm_pageDeleted"));
            fetchPages();
        } else {
            toast.error(t("adm_deleteFailed"));
        }
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

    if (showForm) {
        return (
            <>
                <AdminPageHeader
                    title={editingId ? t("adm_editPage") : t("adm_createPage")}
                    description={t("adm_customPagesSubtitle")}
                    onBack={closeForm}
                    backLabel={commonT("back")}
                />

                <Card>
                    <CardContent className="p-6">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <Label>{`${t("adm_title")} *`}</Label>
                                    <Input aria-label={t("adm_title")} value={title} onChange={(e) => setTitle(e.target.value)} required placeholder={t("adm_pageTitle")} />
                                </div>
                                {!editingId && (
                                    <div>
                                        <Label>{t("adm_slugOptional")}</Label>
                                        <Input aria-label={t("adm_slugOptional")} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-generated-from-title" />
                                    </div>
                                )}
                            </div>
                            <div>
                                <Label>{`${t("adm_contentHtml")} *`}</Label>
                                <RichTextEditor value={content} onChange={setContent} />
                            </div>
                            <div className="flex items-center gap-4">
                                <CheckboxField
                                    checked={isActive}
                                    onChange={(e) => setIsActive(e.target.checked)}
                                    label={t("adm_published")}
                                />
                                <div className="flex items-center gap-2">
                                    <Label className="text-sm">{t("adm_sortOrder")}</Label>
                                    <Input aria-label={t("adm_sortOrder")} type="number" className="w-20" value={order} onChange={(e) => setOrder(parseInt(e.target.value) || 0)} />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button type="submit" disabled={saving}>
                                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                    {editingId ? t("adm_updatePage") : t("adm_createPage")}
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
                title={t("adm_customPages")}
                description={t("adm_customPagesSubtitle")}
                actions={<>
                    <Link href={formHref()} className={buttonClassName("default", "default")}><Plus className="w-4 h-4" /> {t("adm_newPage")}</Link>
                </>}
            />

            <ListControls
                className="mb-4"
                search={{ value: list.search, onChange: list.setSearch }}
            />

            {pages.length === 0 ? (
                <Card><CardContent className="py-8 text-center text-muted-foreground">{t("adm_noPagesYet")}</CardContent></Card>
            ) : list.rows.length === 0 ? (
                <Card><CardContent className="py-8 text-center text-muted-foreground">{commonT("noResults")}</CardContent></Card>
            ) : (
                <div className="space-y-2">
                    <BulkBar
                        className="rounded-lg border border-border"
                        state={list.headerState}
                        count={list.picked.size}
                        onToggleAll={list.toggleAll}
                        actions={
                            <Button variant="destructive" size="sm" onClick={deleteMany}>
                                <Trash2 className="w-4 h-4" /> {commonT("delete")} {list.picked.size}
                            </Button>
                        }
                    />
                    {list.rows.map((page) => (
                        <Card key={page.id}>
                            <CardContent className="p-4 flex items-center justify-between gap-3">
                                <Checkbox
                                    checked={list.picked.has(page.id)}
                                    onChange={() => list.toggle(page.id)}
                                    aria-label={t("adm_selectRow")}
                                />
                                <div className="flex-1 min-w-0">
                                    <h2 className="font-medium text-foreground">{page.title}</h2>
                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                        <ExternalLink className="w-3 h-3" /> /page/{page.slug}
                                        <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${page.isActive ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                                            {page.isActive ? t("adm_published") : t("adm_draft")}
                                        </span>
                                    </p>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Link
                                        href={`/admin/custom-pages/builder/${page.id}`}
                                        title={t("adm_openInBuilder")}
                                        aria-label={t("adm_openInBuilder")}
                                        className={buttonClassName("ghost", "sm")}
                                    >
                                        <LayoutDashboard className="w-3 h-3" />
                                    </Link>
                                    <Button variant="ghost" size="sm" onClick={() => openForm(page.id)} title={t("adm_htmlEditor")}><Pencil className="w-3 h-3" /></Button>
                                    <Button aria-label={commonT("delete")} variant="ghost" size="sm" className="text-destructive" onClick={() => deletePage(page)}><Trash2 className="w-3 h-3" /></Button>
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
