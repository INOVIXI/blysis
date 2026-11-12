"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, IconPicker, Input, Label, LocalizedTextInput, NavIcon, useFormRoute, buttonClassName } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { joinTranslations, originalText, splitTranslations, writeError, type LanguageTexts, type TranslatableText } from "@/core/sdk";
import { AdminPageHeader } from "@/core/sdk/admin";

interface Category {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    order: number;
    isActive: boolean;
    _count: { topics: number };
    /** Every language of its name and description, from the panel's list. */
    translations?: Record<string, LanguageTexts>;
}

interface CategoryForm {
    /** The original and a translation per language. */
    name: TranslatableText;
    description: TranslatableText;
    icon: string;
    color: string;
    order: number;
}

const BLANK: CategoryForm = { name: "", description: "", icon: "", color: "#6366f1", order: 0 };

export default function AdminForumCategoriesPage() {
    const t = useTranslations("forum");
    const commonT = useTranslations("common");
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    // The form is a screen of its own at `?form=new`, not a card above the list,
    // and `?form=<id>` opens a section to be edited: its name and description
    // are written once per language, and a section made before that has to
    // be reachable to be given them.
    const { showForm, editingId, formHref, closeForm } = useFormRoute();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [form, setForm] = useState<CategoryForm>(BLANK);
    const editing = editingId ? categories.find((category) => category.id === editingId) ?? null : null;

    // The section the address names fills the form once the list arrives,
    // so `?form=<id>` survives a reload rather than opening a blank editor.
    useEffect(() => {
        if (!editing) {
            setForm(BLANK);
            return;
        }
        setForm({
            name: joinTranslations(editing.name, editing.translations?.name),
            description: joinTranslations(editing.description ?? "", editing.translations?.description),
            icon: editing.icon ?? "",
            color: editing.color ?? "#6366f1",
            order: editing.order,
        });
    }, [editing]);

    const fetchCategories = async () => {
        try {
            // The operator's answer: a section switched off, or private to a
            // role this operator is not in, is still theirs to manage.
            const res = await fetch("/api/v1/forum/categories?scope=admin");
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);

        try {
            const res = await fetch(editing ? `/api/v1/forum/categories/${editing.id}` : "/api/v1/forum/categories", {
                method: editing ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...form,
                    name: originalText(form.name),
                    description: originalText(form.description),
                    // Both every time: an empty one is how a cleared language goes.
                    translations: {
                        name: splitTranslations(form.name).translations,
                        description: splitTranslations(form.description).translations,
                    },
                }),
            });

            const failed = await writeError(res, t("adm_createCategoryFailed"), t);
            if (failed) {
                setError(failed);
                return;
            }

            setForm(BLANK);
            await fetchCategories();
            closeForm();
        } catch {
            setError(commonT("somethingWentWrong"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const errorBanner = error && (
        <div className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
    );

    if (showForm) {
        return (
            <>
                <AdminPageHeader
                    title={editing ? originalText(form.name) || commonT("edit") : t("adm_newCategory")}
                    description={t("adm_manageCategories")}
                    onBack={closeForm}
                    backLabel={commonT("back")}
                />

                {errorBanner}

                <Card>
                    <CardContent className="p-6">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <Label>{`${t("adm_name")} *`}</Label>
                                    <LocalizedTextInput
                                        label={t("adm_name")}
                                        value={form.name}
                                        onChange={(name) => setForm({ ...form, name })}
                                        maxLength={100}
                                        required
                                    />
                                </div>
                                <div>
                                    {/* The public board draws this through
                                        `NavIcon`, which knows lucide names and
                                        nothing else. A free text box with an
                                        emoji in its placeholder was teaching
                                        operators to pick an icon the board
                                        would never render. */}
                                    <Label htmlFor="forum-category-icon">{t("adm_icon")}</Label>
                                    <IconPicker
                                        id="forum-category-icon"
                                        value={form.icon}
                                        placeholder={t("adm_icon")}
                                        onChange={(icon) => setForm({ ...form, icon })}
                                    />
                                </div>
                            </div>
                            <div>
                                <Label id="forum-category-description">{t("adm_description")}</Label>
                                <LocalizedTextInput
                                    rich
                                    labelledBy="forum-category-description"
                                    label={t("adm_description")}
                                    value={form.description}
                                    onChange={(description) => setForm({ ...form, description })}
                                    maxLength={500}
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <Label>{t("adm_color")}</Label>
                                    <div className="flex gap-2">
                                        <input
                                            aria-label={t("adm_color")}
                                            type="color"
                                            value={form.color}
                                            onChange={(e) => setForm({ ...form, color: e.target.value })}
                                            className="w-10 h-10 rounded cursor-pointer"
                                        />
                                        <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} aria-label={t("adm_color")} />
                                    </div>
                                </div>
                                <div>
                                    <Label>{t("adm_sortOrder")}</Label>
                                    <Input
                                        aria-label={t("adm_sortOrder")}
                                        type="number"
                                        value={form.order}
                                        onChange={(e) => setForm({ ...form, order: parseInt(e.target.value) || 0 })}
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button type="submit" disabled={saving}>
                                    {editing
                                        ? <>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {commonT("save")}</>
                                        : (saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_creating")}</> : t("adm_createCategory"))}
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
                title={t("adm_forumCategories")}
                description={t("adm_manageCategories")}
                actions={<>
                    <Link href={formHref()} className={buttonClassName("default", "default")}>
                            <Plus className="w-4 h-4" /> {t("adm_newCategory")}
                        </Link>
                </>}
            />

            {errorBanner}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {categories.length === 0 ? (
                    <Card className="col-span-full">
                        <CardContent className="py-8 text-center">
                            <p className="text-muted-foreground">{t("adm_noForumCategories")}</p>
                        </CardContent>
                    </Card>
                ) : (
                    categories.map((cat) => (
                        <Card key={cat.id}>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <NavIcon name={cat.icon} className="w-5 h-5" />
                                    <span style={{ color: cat.color || undefined }}>{cat.name}</span>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground mb-3">
                                    {cat.description || t("adm_noDescription")}
                                </p>
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>{t('topicsCount', { count: cat._count.topics })}</span>
                                    <span className={cat.isActive ? "text-success" : "text-muted-foreground"}>
                                        {cat.isActive ? t("adm_active") : t("adm_inactive")}
                                    </span>
                                </div>
                                <Link href={formHref(cat.id)} className={buttonClassName("outline", "sm", "mt-3")}>
                                    {commonT("edit")}
                                </Link>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </>
    );
}
