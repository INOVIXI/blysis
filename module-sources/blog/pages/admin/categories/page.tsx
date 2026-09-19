"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, useConfirm, useFormRoute, buttonClassName } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import { ArrowLeft, Loader2, Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { writeError, errorMessage } from "@/core/sdk";
import { AdminPageHeader, RowActions } from "@/core/sdk/admin";

interface Category {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    _count: { articles: number };
}

export default function AdminBlogCategoriesPage() {
    const t = useTranslations("blog");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    // The form is a screen at `?form=new` or `?form=<id>`, not a card above
    // the list: the row you came to edit stays where it was.
    const { showForm, editingId, formHref, openForm, closeForm } = useFormRoute();
    const [error, setError] = useState<string | null>(null);

    const [form, setForm] = useState({ name: "", description: "" });

    const fetchCategories = useCallback(async () => {
        try {
            const res = await fetch("/api/v1/blog/categories");
            if (res.ok) {
                const data = await res.json();
                setCategories(Array.isArray(data) ? data : data.categories || []);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCategories();
    }, [fetchCategories]);

    // Filled from the row the URL names, once the rows arrive, so reloading
    // `?form=<id>` lands on the same half-finished edit rather than a blank.
    useEffect(() => {
        setError(null);
        if (!editingId) {
            setForm({ name: "", description: "" });
            return;
        }
        const row = categories.find((cat) => cat.id === editingId);
        if (row) setForm({ name: row.name, description: row.description || "" });
    }, [editingId, categories]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);

        try {
            const url = editingId ? `/api/v1/blog/categories/${editingId}` : "/api/v1/blog/categories";
            const method = editingId ? "PATCH" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });

            const failed = await writeError(res, t("adm_saveCategoryFailed"), t);
            if (failed) {
                setError(failed);
                return;
            }

            await fetchCategories();
            closeForm();
        } catch {
            setError(commonT("somethingWentWrong"));
        } finally {
            setSaving(false);
        }
    };

    const deleteCategory = async (id: string) => {
        const ok = await confirm({
            title: t("adm_deleteCatTitle"),
            message: t("adm_deleteCatConfirm"),
            confirmText: t("adm_delete"),
            variant: "danger",
        });
        if (!ok) return;
        try {
            const res = await fetch(`/api/v1/blog/categories/${id}`, { method: "DELETE" });
            if (res.ok) {
                toast.success(t("adm_catDeleted"));
                fetchCategories();
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(errorMessage(data, t("adm_deleteCatError"), t));
            }
        } catch {
            toast.error(t("adm_deleteCatError"));
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (showForm) {
        return (
            <>
                <AdminPageHeader
                    title={editingId ? t("adm_editCategory") : t("adm_newCategory")}
                    description={t("adm_organizeBlog")}
                    onBack={closeForm}
                    backLabel={commonT("back")}
                />

                {error && (
                    <div role="alert" className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
                )}

                <Card>
                    <CardContent className="p-6">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <Label>{`${t("adm_name")} *`}</Label>
                                    <Input
                                        aria-label={t("adm_name")}
                                        value={form.name}
                                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                                        required
                                    />
                                </div>
                                <div>
                                    <Label>{t("adm_description")}</Label>
                                    <Input
                                        aria-label={t("adm_description")}
                                        value={form.description}
                                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                                        placeholder={t("adm_briefDescription")}
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button type="submit" disabled={saving}>
                                    {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_saving")}</> :
                                     editingId ? t("adm_saveChanges") : t("adm_createCategory")}
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
                title={t("adm_blogCategories")}
                description={t("adm_organizeBlog")}
                actions={<>
                    <Link href={formHref()} className={buttonClassName("default", "default")}><Plus className="w-4 h-4" /> {t("adm_newCategory")}</Link>
                </>}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {categories.length === 0 ? (
                    <Card className="col-span-full">
                        <CardContent className="py-12 text-center">
                            <p className="text-muted-foreground">{t("adm_noCategoriesYet")}</p>
                        </CardContent>
                    </Card>
                ) : (
                    categories.map((category) => (
                        <Card key={category.id}>
                            <CardHeader>
                                <CardTitle className="flex items-center justify-between">
                                    <span>{category.name}</span>
                                    <span className="text-sm font-normal text-muted-foreground">
                                        {category._count.articles} articles
                                    </span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground mb-4">
                                    {category.description || t("adm_noDescription")}
                                </p>
                                <p className="text-xs text-muted-foreground mb-3">/{category.slug}</p>
                                <RowActions
                                    className="justify-start"
                                    actions={[
                                        { icon: Pencil, label: t("adm_edit"), onClick: () => openForm(category.id) },
                                        { icon: Trash2, label: t("adm_delete"), onClick: () => deleteCategory(category.id), destructive: true },
                                    ]}
                                />
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </>
    );
}
