"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import Image from "next/image";
import { Button, Card, CardContent, UrlOrFile, Input, Label, RichTextEditor, useConfirm, useFormRoute, NativeSelect, buttonClassName } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import { ArrowLeft, FolderOpen, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { writeError, errorMessage } from "@/core/sdk";
import { AdminPageHeader } from "@/core/sdk/admin";
import {
    EMPTY_CATEGORY,
    categoryPayload,
    categoryWriteTarget,
    type CategoryFormValue,
} from "./category-form";
import { RequirementFields } from "../products/_fields/RequirementFields";

interface Category {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    image: string | null;
    parentId: string | null;
    isActive: boolean;
    order: number;
    visibleAfterProductIds?: string[];
    children?: Category[];
    _count?: { products: number };
}

export default function AdminStoreCategoriesPage() {
    const t = useTranslations("store");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    // The form is a screen at `?form=new`, not a card above the tree.
    const { showForm, formHref, editingId, closeForm } = useFormRoute();
    const [error, setError] = useState<string | null>(null);

    const [form, setForm] = useState<CategoryFormValue>(EMPTY_CATEGORY);

    const fetchCategories = async () => {
        try {
            const res = await fetch("/api/v1/store/categories");
            if (res.ok) {
                const data = await res.json();
                setCategories(data.categories || []);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCategories();
    }, []);

    // Opening the form on a row fills it from the tree already loaded, rather
    // than fetching the row again; leaving edit clears it, so the next "new"
    // does not start with somebody else's name in the box.
    useEffect(() => {
        if (!editingId) {
            setForm(EMPTY_CATEGORY);
            return;
        }
        const flat = categories.flatMap((c) => [c, ...(c.children ?? [])]);
        const row = flat.find((c) => c.id === editingId);
        if (!row) return;
        setForm({
            name: row.name,
            description: row.description ?? "",
            image: row.image ?? "",
            parentId: row.parentId ?? "",
            order: String(row.order ?? 0),
            isActive: row.isActive,
            visibleAfterProductIds: row.visibleAfterProductIds ?? [],
        });
    }, [editingId, categories]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);

        try {
            const target = categoryWriteTarget(editingId);
            const res = await fetch(target.url, {
                method: target.method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(categoryPayload(form)),
            });

            const failed = await writeError(res, t("adm_createCategoryFailed"), t);
            if (failed) {
                setError(failed);
                return;
            }

            setForm(EMPTY_CATEGORY);
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
            title: t("cat_deleteTitle"),
            message: t("cat_deleteConfirm"),
            confirmText: t("cat_delete"),
            variant: "danger",
        });
        if (!ok) return;
        try {
            const res = await fetch(`/api/v1/store/categories/${id}`, { method: "DELETE" });
            if (res.ok) {
                fetchCategories();
                toast.success(t("cat_deletedToast"));
            } else {
                const data = await res.json();
                toast.error(errorMessage(data, t("cat_deleteError"), t));
            }
        } catch {
            toast.error(t("cat_deleteError"));
        }
    };

    // Flatten categories for parent select (only root-level)
    const rootCategories = categories.filter((c) => !c.parentId);

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
                    description={t("adm_organizeProducts")}
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
                                    <Label>{t("adm_parentCategory")}</Label>
                                    <NativeSelect
                                        aria-label={t("adm_parentCategory")}
                                        value={form.parentId}
                                        onChange={(e) => setForm({ ...form, parentId: e.target.value })} className="w-full"
                                    >
                                        <option value="">{t("adm_rootCategory")}</option>
                                        {rootCategories.map((cat) => (
                                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                                        ))}
                                    </NativeSelect>
                                </div>
                            </div>
                            <div>
                                <Label>{t("adm_description")}</Label>
                                <RichTextEditor
                                    value={form.description}
                                    onChange={(value: string) => setForm({ ...form, description: value })}
                                />
                            </div>
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <Label>{t("adm_imageUrl")}</Label>
                                    <UrlOrFile
                                        value={form.image || ""}
                                        onChange={(v) => setForm({ ...form, image: v })}
                                        accept="image/*"
                                    />
                                </div>
                                <div>
                                    <Label>{t("adm_sortOrder")}</Label>
                                    <Input
                                        aria-label={t("adm_sortOrder")}
                                        type="number"
                                        value={form.order}
                                        onChange={(e) => setForm({ ...form, order: e.target.value })}
                                    />
                                </div>
                            </div>
                            <RequirementFields
                                value={{
                                    requiresProductIds: form.visibleAfterProductIds,
                                    requiresAny: true,
                                }}
                                onChange={(next) =>
                                    setForm({ ...form, visibleAfterProductIds: next.requiresProductIds })
                                }
                                hideAnySwitch
                                title={t("adm_shelfGate")}
                                hint={t("adm_shelfGateHint")}
                            />

                            <div className="flex gap-2">
                                <Button type="submit" disabled={saving}>
                                    {saving
                                        ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_creating")}</>
                                        : editingId ? t("adm_saveCategory") : t("adm_createCategory")}
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
                title={t("adm_storeCategories")}
                description={t("adm_organizeProducts")}
                actions={<>
                    <Link href={formHref()} className={buttonClassName("default", "default")}><Plus className="w-4 h-4" /> {t("adm_newCategory")}</Link>
                </>}
            />

            {/* Category Tree */}
            <div className="space-y-4">
                {categories.length === 0 ? (
                    <Card>
                        <CardContent className="py-8 text-center">
                            <p className="text-muted-foreground">{t("adm_noStoreCategories")}</p>
                        </CardContent>
                    </Card>
                ) : (
                    rootCategories.map((cat) => (
                        <Card key={cat.id}>
                            <CardContent className="p-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {cat.image ? (
                                            <Image src={cat.image} alt={cat.name} width={40} height={40} className="w-10 h-10 rounded-lg object-cover" />
                                        ) : (
                                            <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
                                                <FolderOpen className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                                            </div>
                                        )}
                                        <div>
                                            <p className="font-medium">{cat.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {cat._count?.products || 0} products · /{cat.slug}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-xs px-2 py-1 rounded ${cat.isActive ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                                            {cat.isActive ? t("adm_active") : t("adm_inactive")}
                                        </span>
                                        <Link
                                            href={formHref(cat.id)}
                                            aria-label={commonT("edit")}
                                            className={buttonClassName("ghost", "sm")}
                                        >
                                            <Pencil className="w-4 h-4" aria-hidden="true" />
                                        </Link>
                                        <Button
                                            aria-label={commonT("delete")}
                                            variant="ghost"
                                            size="sm"
                                            className="text-destructive"
                                            onClick={() => deleteCategory(cat.id)}
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </Button>
                                    </div>
                                </div>

                                {/* Sub-categories */}
                                {cat.children && cat.children.length > 0 && (
                                    <div className="ml-12 mt-3 space-y-2">
                                        {cat.children.map((sub) => (
                                            <div key={sub.id} className="flex items-center justify-between py-2 border-t border-border">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-muted-foreground">└</span>
                                                    <p className="text-sm font-medium">{sub.name}</p>
                                                    <p className="text-xs text-muted-foreground">/{sub.slug}</p>
                                                </div>
                                                <Button
                                                    aria-label={commonT("delete")}
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-destructive"
                                                    onClick={() => deleteCategory(sub.id)}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </>
    );
}
